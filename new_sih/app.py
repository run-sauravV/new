import os
import logging
from datetime import datetime
from typing import Optional, Dict, Any
import uuid
from io import BytesIO

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import piexif
from dotenv import load_dotenv
import requests

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

SENTINEL_HUB_CLIENT_ID = os.getenv("SENTINEL_HUB_CLIENT_ID", "")
SENTINEL_HUB_CLIENT_SECRET = os.getenv("SENTINEL_HUB_CLIENT_SECRET", "")
OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")
EE_PROJECT_ID = os.getenv("EE_PROJECT_ID", "")

UPLOADS = {}
RESULTS = {}

class ExifData(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    altitude: Optional[float] = None
    camera_pitch: Optional[float] = None
    camera_heading: Optional[float] = None
    timestamp: Optional[str] = None

class UploadResponse(BaseModel):
    success: bool
    upload_id: str
    exif: ExifData
    message: str

class ResultsResponse(BaseModel):
    upload_id: str
    status: str
    cv_output: Optional[Dict[str, Any]] = None
    gis_output: Optional[Dict[str, Any]] = None
    processing_time_seconds: int
    error: Optional[str] = None

def extract_exif(file_bytes: bytes) -> Optional[dict]:
    try:
        exif_dict = piexif.load(file_bytes)
        gps = exif_dict.get("GPS", {})
        
        if piexif.GPSIFD.GPSLatitude in gps and piexif.GPSIFD.GPSLongitude in gps:
            lat_data = gps[piexif.GPSIFD.GPSLatitude]
            lat = float(lat_data[0][0]) / lat_data[0][1] + \
                  float(lat_data[1][0]) / (lat_data[1][1] * 60) + \
                  float(lat_data[2][0]) / (lat_data[2][1] * 3600)
            if gps.get(piexif.GPSIFD.GPSLatitudeRef) == b'S':
                lat = -lat
            
            lon_data = gps[piexif.GPSIFD.GPSLongitude]
            lon = float(lon_data[0][0]) / lon_data[0][1] + \
                  float(lon_data[1][0]) / (lon_data[1][1] * 60) + \
                  float(lon_data[2][0]) / (lon_data[2][1] * 3600)
            if gps.get(piexif.GPSIFD.GPSLongitudeRef) == b'W':
                lon = -lon
            
            altitude = None
            if piexif.GPSIFD.GPSAltitude in gps:
                alt_data = gps[piexif.GPSIFD.GPSAltitude]
                altitude = float(alt_data[0]) / alt_data[1]
            
            return {
                "latitude": round(lat, 6),
                "longitude": round(lon, 6),
                "altitude": round(altitude, 2) if altitude else None,
                "camera_pitch": None,
                "camera_heading": None,
                "timestamp": datetime.utcnow().isoformat()
            }
    except Exception as e:
        logger.warning(f"EXIF extraction failed: {e}")
    
    return None

def get_dem_from_earth_engine(lat: float, lon: float) -> Dict[str, Any]:
    try:
        import ee
        ee.Initialize(project=EE_PROJECT_ID)

        point = ee.Geometry.Point([lon, lat])
        dem = ee.Image('USGS/SRTMGL1_003')

        # Sample a 3x3 grid of real elevations around the point to find
        # the steepest downhill direction (basic flow direction, no mock)
        step = 0.0009  # roughly 100m at mid-latitudes
        offsets = {
            "N":  (0, step), "NE": (step, step), "E": (step, 0), "SE": (step, -step),
            "S":  (0, -step), "SW": (-step, -step), "W": (-step, 0), "NW": (-step, step)
        }

        center_elev = dem.sample(point, 30).first().get('elevation').getInfo()

        drops = {}
        for direction, (dx, dy) in offsets.items():
            neighbor = ee.Geometry.Point([lon + dx, lat + dy])
            neighbor_elev = dem.sample(neighbor, 30).first().get('elevation').getInfo()
            drops[direction] = center_elev - neighbor_elev  # positive = downhill

        flow_direction = max(drops, key=drops.get)
        steepest_drop = drops[flow_direction]

        # Real slope from the DEM itself (degrees), not a photo proxy
        slope_image = ee.Terrain.slope(dem)
        dem_slope_deg = slope_image.sample(point, 30).first().get('slope').getInfo()

        # Rough catchment estimate from local slope, not a full flow-accumulation model
        avg_slope_pct = abs(steepest_drop) / 100.0  # drop over ~100m step
        catchment_area_sqkm = round(max(5.0, 100.0 / (1 + avg_slope_pct * 10)), 1)

        logger.info(f"Elevation {center_elev}m at ({lat},{lon}), slope {dem_slope_deg}°, flow toward {flow_direction}")
        return {
            "elevation_m": float(center_elev),
            "dem_source": "USGS SRTM GL1 (Earth Engine)",
            "resolution_m": 30,
            "flow_direction": flow_direction,
            "catchment_area_sqkm": catchment_area_sqkm,
            "steepest_drop_m": round(steepest_drop, 2),
            "dem_slope_deg": round(float(dem_slope_deg), 1)
        }
    except Exception as e:
        logger.warning(f"Earth Engine failed: {e}. Using mock data.")
        return {
            "elevation_m": 234.5,
            "dem_source": "Mock (Earth Engine unavailable)",
            "resolution_m": 30,
            "flow_direction": "S",
            "catchment_area_sqkm": 45.3,
            "steepest_drop_m": None,
            "dem_slope_deg": None
        }

def get_satellite_ndvi(lat: float, lon: float) -> Dict[str, Any]:
    try:
        import ee
        import numpy as np
        import base64
        from PIL import Image as PILImage

        ee.Initialize(project=EE_PROJECT_ID)

        point = ee.Geometry.Point([lon, lat])
        bbox = point.buffer(2000).bounds()

        collection = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(bbox)
            .filterDate("2026-01-01", "2026-09-07")
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
            .sort("CLOUDY_PIXEL_PERCENTAGE")
        )

        image = collection.first()

        # Real NDVI at point
        ndvi_image = image.normalizedDifference(["B8", "B4"])
        ndvi_value = ndvi_image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=bbox,
            scale=10
        ).get("nd").getInfo()

        # True color thumbnail (RGB)
        viz_params = {"min": 0, "max": 3000, "bands": ["B4", "B3", "B2"]}
        thumb_url = image.getThumbURL({
            "min": 0,
            "max": 3000,
            "bands": ["B4", "B3", "B2"],
            "region": bbox,
            "dimensions": 512,
            "format": "png"
        })

        thumb_resp = requests.get(thumb_url, timeout=30)
        true_color_base64 = None

        if thumb_resp.status_code == 200:
            pil_img = PILImage.open(BytesIO(thumb_resp.content))
            buffer = BytesIO()
            pil_img.save(buffer, format="PNG")
            true_color_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
            logger.info(f"Got real satellite image from GEE for ({lat},{lon})")

        ndvi_mean = round(float(ndvi_value), 3) if ndvi_value is not None else None
        logger.info(f"Got real NDVI {ndvi_mean} from GEE for ({lat},{lon})")

        return {
            "ndvi_mean": ndvi_mean,
            "true_color_base64": true_color_base64,
            "source": "Sentinel-2 via Google Earth Engine",
            "date": datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.warning(f"GEE satellite fetch failed: {e}. Using mock data.")
        return {
            "ndvi_mean": None,
            "true_color_base64": None,
            "source": "Sentinel-2 (mock fallback)",
            "date": datetime.utcnow().isoformat()
        }

def get_weather_data(lat: float, lon: float) -> Dict[str, Any]:
    if not OPENWEATHER_API_KEY:
        logger.info("OpenWeather API key missing, returning mock weather")
        return {
            "temperature_c": 25,
            "humidity_percent": 65,
            "rainfall_mm": 0,
            "source": "Mock"
        }
    
    try:
        url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={OPENWEATHER_API_KEY}&units=metric"
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        
        data = response.json()
        rainfall = data.get('rain', {}).get('1h', 0)
        
        logger.info(f"Got weather data for ({lat}, {lon})")
        return {
            "temperature_c": data['main']['temp'],
            "humidity_percent": data['main']['humidity'],
            "rainfall_mm": rainfall,
            "source": "OpenWeatherMap"
        }
    except Exception as e:
        logger.warning(f"OpenWeather failed: {e}. Using mock weather.")
        return {
            "temperature_c": 25,
            "humidity_percent": 65,
            "rainfall_mm": 0,
            "source": "Mock (OpenWeather failed)"
        }

def segment_photo(photo_bytes: bytes, exif: dict) -> Dict[str, Any]:
    """
    Vegetation density and slope-from-shading are computed from real pixel
    data below. Erosion and water body detection need a trained model
    (YOLO/SAM) from Member 3 - that part is still a placeholder.
    """
    try:
        from PIL import Image
        import numpy as np

        img = Image.open(BytesIO(photo_bytes)).convert("RGB")
        img_array = np.array(img).astype(float)
        height, width = img_array.shape[:2]

        r, g, b = img_array[:, :, 0], img_array[:, :, 1], img_array[:, :, 2]

        # Excess Green Index as a real proxy for vegetation coverage
        exg = 2 * g - r - b
        vegetation_mask = exg > 15
        vegetation_density = round(float(vegetation_mask.mean()), 3)

        # Real (rough) slope proxy from vertical brightness gradient -
        # not a substitute for DEM slope, but genuinely computed from the photo
        gray = img_array.mean(axis=2)
        vertical_gradient = np.abs(np.diff(gray, axis=0))
        slope_estimate = round(float(vertical_gradient.mean()) * 2, 1)

        logger.info(f"Analyzed photo {width}x{height}: veg={vegetation_density}, slope_proxy={slope_estimate}")
        return {
            "erosion_zones": [],  # needs Member 3's trained model - placeholder
            "water_bodies": [],   # needs Member 3's trained model - placeholder
            "vegetation_density": vegetation_density,
            "slope_estimate": slope_estimate,
            "cv_model_status": "vegetation/slope are real pixel analysis; erosion/water detection pending trained model"
        }
    except Exception as e:
        logger.warning(f"Photo analysis failed: {e}. Using fallback values.")
        return {
            "erosion_zones": [],
            "water_bodies": [],
            "vegetation_density": 0.5,
            "slope_estimate": 10.0,
            "cv_model_status": "analysis failed, fallback values used"
        }

def compute_runoff_coefficient(slope_deg: float, vegetation: float, rainfall: float) -> float:
    base_cn = 70

    if slope_deg > 20:
        base_cn += 10

    cn = base_cn + (1 - vegetation) * 5

    if rainfall > 50:
        cn += 5

    runoff = (cn - 30) / 70
    return round(min(max(runoff, 0), 1), 2)

def process_upload_background(upload_id: str, photo_bytes: bytes, exif_data: dict):
    try:
        start_time = datetime.utcnow()
        
        cv_result = segment_photo(photo_bytes, exif_data)
        gis_result = get_dem_from_earth_engine(exif_data["latitude"], exif_data["longitude"])
        weather = get_weather_data(exif_data["latitude"], exif_data["longitude"])
        satellite = get_satellite_ndvi(exif_data["latitude"], exif_data["longitude"])

        # Prefer real DEM slope; fall back to the photo-brightness proxy only if DEM failed
        slope_for_runoff = gis_result.get("dem_slope_deg")
        if slope_for_runoff is None:
            slope_for_runoff = cv_result.get("slope_estimate", 10.0)

        runoff = compute_runoff_coefficient(
            slope_for_runoff,
            cv_result.get("vegetation_density", 0.65),
            weather.get("rainfall_mm", 0)
        )
        
        gis_result["runoff_coefficient"] = runoff
        gis_result["weather"] = weather
        gis_result["satellite"] = satellite
        
        end_time = datetime.utcnow()
        processing_time = int((end_time - start_time).total_seconds())
        
        RESULTS[upload_id] = {
            "cv": cv_result,
            "gis": gis_result,
            "completed": end_time.isoformat(),
            "processing_time_seconds": processing_time,
            "error": None
        }
        
        logger.info(f"Upload {upload_id} completed in {processing_time}s")
    except Exception as e:
        logger.error(f"Background processing failed for {upload_id}: {e}")
        RESULTS[upload_id] = {
            "cv": None,
            "gis": None,
            "completed": datetime.utcnow().isoformat(),
            "processing_time_seconds": 0,
            "error": str(e)
        }

app = FastAPI(
    title="Watershed Backend",
    version="1.0.0",
    description="Field photo analysis - CV + GIS pipeline"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "uploads": len(UPLOADS),
        "processed": len(RESULTS)
    }

@app.post("/api/v1/upload", response_model=UploadResponse, status_code=201)
async def upload_photo(background_tasks: BackgroundTasks, photo: UploadFile = File(...)):
    file_bytes = await photo.read()
    
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")
    
    if len(file_bytes) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")
    
    exif_data = extract_exif(file_bytes)
    
    if not exif_data:
        raise HTTPException(status_code=400, detail="No GPS data in photo EXIF")
    
    upload_id = str(uuid.uuid4())
    UPLOADS[upload_id] = {
        "exif": exif_data,
        "filename": photo.filename,
        "timestamp": datetime.utcnow().isoformat()
    }
    
    RESULTS[upload_id] = {
        "cv": None,
        "gis": None,
        "completed": None,
        "processing_time_seconds": 0,
        "error": None
    }
    
    background_tasks.add_task(process_upload_background, upload_id, file_bytes, exif_data)
    
    logger.info(f"Upload {upload_id} accepted")
    
    return UploadResponse(
        success=True,
        upload_id=upload_id,
        exif=ExifData(**exif_data),
        message="Photo uploaded. Processing started."
    )

@app.get("/api/v1/results/{upload_id}", response_model=ResultsResponse)
async def get_results(upload_id: str):
    if upload_id not in UPLOADS:
        raise HTTPException(status_code=404, detail="Upload not found")
    
    result = RESULTS.get(upload_id)
    
    if not result:
        return ResultsResponse(
            upload_id=upload_id,
            status="processing",
            cv_output=None,
            gis_output=None,
            processing_time_seconds=0
        )
    
    if result.get("error"):
        return ResultsResponse(
            upload_id=upload_id,
            status="failed",
            cv_output=None,
            gis_output=None,
            processing_time_seconds=result.get("processing_time_seconds", 0),
            error=result["error"]
        )
    
    if result.get("completed") is None:
        return ResultsResponse(
            upload_id=upload_id,
            status="processing",
            cv_output=None,
            gis_output=None,
            processing_time_seconds=0
        )
    
    return ResultsResponse(
        upload_id=upload_id,
        status="complete",
        cv_output=result["cv"],
        gis_output=result["gis"],
        processing_time_seconds=result["processing_time_seconds"]
    )

@app.get("/api/v1/uploads")
async def list_uploads():
    return {
        "count": len(UPLOADS),
        "uploads": [
            {
                "id": uid,
                "exif": UPLOADS[uid]["exif"],
                "status": "complete" if RESULTS[uid].get("completed") else "processing"
            }
            for uid in UPLOADS
        ]
    }

@app.delete("/api/v1/uploads/{upload_id}")
async def delete_upload(upload_id: str):
    if upload_id not in UPLOADS:
        raise HTTPException(status_code=404, detail="Upload not found")
    
    UPLOADS.pop(upload_id, None)
    RESULTS.pop(upload_id, None)
    
    return {"success": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
