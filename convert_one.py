import os
import cv2
import numpy as np
import rasterio

# ============================================================
# FILE PATHS
# ============================================================

image_path = "dataset/raw_images/Bolivia_103757_S2Hand.tif"
label_path = "dataset/raw_labels/Bolivia_103757_LabelHand.tif"

image_output = "dataset/images/test_water.jpg"
label_output = "dataset/labels/test_water.txt"

os.makedirs("dataset/images", exist_ok=True)
os.makedirs("dataset/labels", exist_ok=True)

# ============================================================
# READ SENTINEL-2 IMAGE
# ============================================================

with rasterio.open(image_path) as src:
    image = src.read()

print("Original image shape:", image.shape)

# Sentinel-2:
# B2 = Blue  -> index 1
# B3 = Green -> index 2
# B4 = Red   -> index 3

blue = image[1].astype(np.float32)
green = image[2].astype(np.float32)
red = image[3].astype(np.float32)

# A pixel is valid if at least one Sentinel-2 band has data.
valid_pixels = np.any(image != 0, axis=0)

# ============================================================
# CREATE RGB IMAGE
# ============================================================

rgb = np.stack([red, green, blue], axis=-1)

# Replace invalid/no-data pixels with zero.
rgb[~valid_pixels] = 0

# Contrast stretching
rgb_uint8 = np.zeros_like(rgb, dtype=np.uint8)

for i in range(3):

    band = rgb[:, :, i]

    valid_values = band[valid_pixels]

    if len(valid_values) > 0:

        low = np.percentile(valid_values, 2)
        high = np.percentile(valid_values, 98)

        if high > low:

            stretched = (
                (band - low) /
                (high - low) *
                255
            )

            stretched = np.clip(stretched, 0, 255)

            rgb_uint8[:, :, i] = stretched.astype(np.uint8)

# Keep no-data area black.
rgb_uint8[~valid_pixels] = 0

# ============================================================
# READ WATER LABEL
# ============================================================

with rasterio.open(label_path) as src:
    mask = src.read(1)

print("Label shape:", mask.shape)
print("Label values:", np.unique(mask))

# Label meanings:
# -1 = invalid / ignore
#  0 = non-water
#  1 = water

water_mask = (mask == 1).astype(np.uint8)

# Never allow no-data satellite pixels to become water.
water_mask[~valid_pixels] = 0

# ============================================================
# SAVE RGB IMAGE
# ============================================================

cv2.imwrite(
    image_output,
    cv2.cvtColor(rgb_uint8, cv2.COLOR_RGB2BGR)
)

print("Image saved:", image_output)

# ============================================================
# FIND WATER REGIONS
# ============================================================

contours, _ = cv2.findContours(
    water_mask,
    cv2.RETR_EXTERNAL,
    cv2.CHAIN_APPROX_SIMPLE
)

print("Water regions found:", len(contours))

# ============================================================
# CREATE YOLO SEGMENTATION LABEL
# ============================================================

height, width = water_mask.shape

with open(label_output, "w") as f:

    saved_regions = 0

    for contour in contours:

        # Ignore tiny regions/noise.
        if cv2.contourArea(contour) < 10:
            continue

        # Simplify polygon.
        epsilon = 0.002 * cv2.arcLength(
            contour,
            True
        )

        polygon = cv2.approxPolyDP(
            contour,
            epsilon,
            True
        )

        if len(polygon) < 3:
            continue

        points = polygon.reshape(-1, 2)

        normalized = []

        for x, y in points:

            normalized.append(
                x / width
            )

            normalized.append(
                y / height
            )

        # YOLO segmentation:
        # class_id x1 y1 x2 y2 x3 y3 ...

        f.write(
            "0 " +
            " ".join(
                f"{p:.6f}"
                for p in normalized
            ) +
            "\n"
        )

        saved_regions += 1

print("YOLO water regions saved:", saved_regions)
print("YOLO label saved:", label_output)

# ============================================================
# SUMMARY
# ============================================================

print("----------------------------------------")
print("CONVERSION COMPLETED")
print("----------------------------------------")
print("Image size: 512 x 512")
print("Class 0: water")
print("No-data pixels: ignored")
print("RGB image:", image_output)
print("YOLO label:", label_output)