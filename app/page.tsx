'use client';

import { useState, useEffect } from 'react';
import {
  Droplet,
  Home as HomeIcon,
  Upload,
  Map as MapIcon,
  FileText,
  Bell,
  Leaf,
  Mountain,
  Droplets,
  Navigation,
  Plus,
  Minus,
  Compass,
  Calendar,
  Cloud,
  Maximize2,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

interface ExifData {
  latitude: number;
  longitude: number;
  altitude?: number;
  timestamp?: string;
}

interface AnalysisResults {
  upload_id: string;
  status: 'processing' | 'complete' | 'failed';
  processing_time_seconds: number;
  error?: string;
  cv_output?: {
    vegetation_density: number;
    slope_estimate: number;
    cv_model_status: string;
  };
  gis_output?: {
    elevation_m: number;
    dem_source: string;
    flow_direction: string;
    catchment_area_sqkm: number;
    dem_slope_deg?: number;
    runoff_coefficient?: number;
    weather?: {
      temperature_c: number;
      humidity_percent: number;
      rainfall_mm: number;
      source: string;
    };
    satellite?: {
      ndvi_mean?: number;
      true_color_base64?: string;
      source: string;
    };
  };
}

// Placeholder shown before a real upload has finished processing, so the
// dashboard always reads as populated rather than empty.
const DEMO = {
  vegetation: 0.78,
  elevation: 234.5,
  runoff: 0.57,
  flowDirection: 'South',
  lat: 28.7039,
  lng: 77.1025,
  altitude: 234.0,
  captured: '05 Sep 2026, 14:32',
  tempC: 29.1,
  condition: 'Partly Cloudy',
  humidity: 84,
  rainfall: 0,
  catchmentArea: 45.3,
  ndviTrend: [
    { day: 'Aug 30', ndvi: 0.62 },
    { day: 'Aug 31', ndvi: 0.58 },
    { day: 'Sep 1', ndvi: 0.66 },
    { day: 'Sep 2', ndvi: 0.6 },
    { day: 'Sep 3', ndvi: 0.64 },
    { day: 'Sep 4', ndvi: 0.7 },
    { day: 'Sep 5', ndvi: 0.72 },
  ],
};

const NAV_ITEMS = [
  { label: 'Dashboard', icon: HomeIcon },
  { label: 'Uploads', icon: Upload },
  { label: 'Map', icon: MapIcon },
  { label: 'Reports', icon: FileText },
];

const MAP_TABS = ['Map', 'Satellite', 'NDVI', 'Erosion', 'Water Bodies', 'Watershed'];
const ANALYSIS_TABS = ['Detailed Analysis', 'Satellite & NDVI', 'Erosion', 'Water Bodies', 'Topography'];

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [exif, setExif] = useState<ExifData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [activeNav, setActiveNav] = useState('Dashboard');
  const [mapTab, setMapTab] = useState('Map');
  const [analysisTab, setAnalysisTab] = useState('Detailed Analysis');
  const [satelliteView, setSatelliteView] = useState<'True Color' | 'NDVI'>('True Color');
  const [layers, setLayers] = useState({
    boundary: true,
    erosion: false,
    water: false,
    flow: true,
    ndviOverlay: false,
  });
  const fileInputRef = useState<HTMLInputElement | null>(null);

  // Poll backend for results when uploadId changes
  useEffect(() => {
    if (!uploadId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/results/${uploadId}`);
        if (!res.ok) throw new Error('Failed to fetch analysis status');

        const data: AnalysisResults = await res.json();

        if (data.status === 'complete') {
          setResults(data);
          setLoading(false);
          clearInterval(interval);
        } else if (data.status === 'failed') {
          setError(data.error || 'Processing failed on the server.');
          setLoading(false);
          clearInterval(interval);
        }
      } catch (err: any) {
        setError(err.message || 'Error polling results.');
        setLoading(false);
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [uploadId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setError(null);
      setResults(null);
      setUploadId(null);
      setExif(null);
      handleUpload(e.target.files[0]);
    }
  };

  const handleUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    setResults(null);

    const formData = new FormData();
    formData.append('photo', file);

    try {
      const res = await fetch(`${API_BASE}/api/v1/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Upload failed');
      }

      setExif(data.exif);
      setUploadId(data.upload_id);
    } catch (err: any) {
      setError(err.message || 'An error occurred during upload.');
      setLoading(false);
    }
  };

  // Merge live results over the demo defaults so the dashboard is always populated.
  const vegetation = results?.cv_output?.vegetation_density ?? DEMO.vegetation;
  const elevation = results?.gis_output?.elevation_m ?? DEMO.elevation;
  const runoff = results?.gis_output?.runoff_coefficient ?? DEMO.runoff;
  const flowDirection = results?.gis_output?.flow_direction ?? DEMO.flowDirection;
  const lat = exif?.latitude ?? DEMO.lat;
  const lng = exif?.longitude ?? DEMO.lng;
  const altitude = exif?.altitude ?? DEMO.altitude;
  const captured = exif?.timestamp
    ? new Date(exif.timestamp).toLocaleString()
    : DEMO.captured;
  const tempC = results?.gis_output?.weather?.temperature_c ?? DEMO.tempC;
  const humidity = results?.gis_output?.weather?.humidity_percent ?? DEMO.humidity;
  const rainfall = results?.gis_output?.weather?.rainfall_mm ?? DEMO.rainfall;
  const catchmentArea = results?.gis_output?.catchment_area_sqkm ?? DEMO.catchmentArea;
  const satelliteImage = results?.gis_output?.satellite?.true_color_base64;
  const vegPct = Math.round(vegetation * 100);

  const toggleLayer = (key: keyof typeof layers) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-800 flex relative">
      {/* Fixed starfield background, NASA.gov-style deep space backdrop */}
      <Starfield />

      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-white border-r border-slate-200 flex flex-col relative z-10">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center">
            <Droplet className="w-4 h-4 text-white" fill="white" />
          </div>
          <span className="font-semibold text-slate-800 text-[15px] leading-tight">
            Watershed Monitoring System
          </span>
        </div>

        <nav className="mt-2 flex flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ label, icon: Icon }) => {
            const active = activeNav === label;
            return (
              <button
                key={label}
                onClick={() => setActiveNav(label)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                  active
                    ? 'bg-sky-50 text-sky-600'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 relative z-10">
        {/* Hero banner with Earth imagery, NASA.gov-style full-bleed photo section */}
        <div
          className="relative h-48 md:h-56 bg-cover bg-center flex items-end"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(2,6,23,0.35) 0%, rgba(2,6,23,0.85) 100%), url('/images/hero-satellite.jpg')",
          }}
        >
          <div className="flex items-center justify-between w-full px-8 pb-5">
            <div>
              <h1 className="text-2xl font-bold text-white drop-shadow-sm">Dashboard</h1>
              <p className="text-sm text-slate-200/90 mt-0.5 max-w-md">
                Monitor watershed health and get real-time insights from field data.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer transition-colors shadow-lg shadow-sky-950/40">
                <Upload className="w-4 h-4" />
                {loading ? 'Uploading…' : 'Upload Photo'}
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </label>
              <button className="text-slate-100/80 hover:text-white">
                <Bell className="w-5 h-5" />
              </button>
              <div className="w-9 h-9 rounded-full bg-white/10 backdrop-blur border border-white/30 text-white flex items-center justify-center text-sm font-semibold">
                M
              </div>
            </div>
          </div>
        </div>

        <main className="p-8 space-y-6 bg-slate-50">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatCard
              icon={<Leaf className="w-5 h-5 text-emerald-500" />}
              iconBg="bg-emerald-50"
              label="Vegetation Density"
              value={`${vegPct}%`}
            >
              <div className="w-full h-1.5 bg-slate-100 rounded-full mt-3 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${vegPct}%` }}
                />
              </div>
            </StatCard>

            <StatCard
              icon={<Mountain className="w-5 h-5 text-sky-500" />}
              iconBg="bg-sky-50"
              label="Elevation"
              value={`${elevation} m`}
            />

            <StatCard
              icon={<Droplets className="w-5 h-5 text-blue-500" />}
              iconBg="bg-blue-50"
              label="Runoff Coefficient"
              value={`${runoff}`}
            />

            <StatCard
              icon={<Navigation className="w-5 h-5 text-emerald-500" />}
              iconBg="bg-emerald-50"
              label="Flow Direction"
              value={flowDirection}
            />
          </div>

          {/* Map + right rail */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
            {/* Map card */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-200">
                {MAP_TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setMapTab(tab)}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      mapTab === tab
                        ? 'border-sky-500 text-sky-600'
                        : 'border-transparent text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="relative h-[420px] bg-gradient-to-br from-emerald-900 via-emerald-700 to-emerald-800 overflow-hidden">
                {satelliteImage ? (
                  <img
                    src={`data:image/png;base64,${satelliteImage}`}
                    alt="Satellite basemap"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src="/images/watershed-river.jpg"
                    alt="Watershed satellite basemap"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}

                {/* Watershed boundary overlay */}
                {layers.boundary && (
                  <svg
                    viewBox="0 0 700 420"
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  >
                    <polygon
                      points="230,120 330,90 430,110 520,160 560,230 520,300 440,340 340,350 250,330 180,270 160,190"
                      fill="rgba(56,189,248,0.08)"
                      stroke="#38bdf8"
                      strokeWidth="2"
                    />
                    {layers.flow && (
                      <g stroke="#38bdf8" strokeWidth="2" fill="none" markerEnd="url(#arrow)">
                        <line x1="350" y1="210" x2="320" y2="150" />
                        <line x1="350" y1="210" x2="420" y2="160" />
                        <line x1="350" y1="210" x2="480" y2="220" />
                        <line x1="350" y1="210" x2="440" y2="300" />
                        <line x1="350" y1="210" x2="300" y2="310" />
                        <line x1="350" y1="210" x2="220" y2="230" />
                      </g>
                    )}
                    <defs>
                      <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
                        <path d="M0,0 L8,4 L0,8 Z" fill="#38bdf8" />
                      </marker>
                    </defs>
                  </svg>
                )}

                {/* Location pin */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 rounded-full bg-sky-500 border-2 border-white shadow" />
                </div>

                {/* Zoom controls */}
                <div className="absolute top-3 left-3 flex flex-col rounded-lg overflow-hidden border border-white/20 bg-black/30 backdrop-blur-sm">
                  <button className="w-8 h-8 flex items-center justify-center text-white hover:bg-white/10">
                    <Plus className="w-4 h-4" />
                  </button>
                  <button className="w-8 h-8 flex items-center justify-center text-white hover:bg-white/10 border-t border-white/20">
                    <Minus className="w-4 h-4" />
                  </button>
                </div>

                {/* Compass */}
                <div className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center">
                  <Compass className="w-4 h-4 text-white" />
                </div>

                {/* Layers panel */}
                <div className="absolute top-14 right-3 w-44 bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs">
                  <p className="font-semibold text-slate-700 mb-2">Layers</p>
                  <LayerCheckbox
                    label="Watershed Boundary"
                    checked={layers.boundary}
                    onChange={() => toggleLayer('boundary')}
                  />
                  <LayerCheckbox
                    label="Erosion Zones"
                    checked={layers.erosion}
                    onChange={() => toggleLayer('erosion')}
                  />
                  <LayerCheckbox
                    label="Water Bodies"
                    checked={layers.water}
                    onChange={() => toggleLayer('water')}
                  />
                  <LayerCheckbox
                    label="Flow Direction"
                    checked={layers.flow}
                    onChange={() => toggleLayer('flow')}
                  />
                  <LayerCheckbox
                    label="NDVI Overlay"
                    checked={layers.ndviOverlay}
                    onChange={() => toggleLayer('ndviOverlay')}
                  />
                </div>

                {/* Scale bar */}
                <div className="absolute bottom-3 left-3 text-white text-[11px]">
                  <div className="w-14 h-[2px] bg-white mb-1" />
                  500 m
                </div>

                {loading && (
                  <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center gap-3 text-white text-sm">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Fetching satellite, elevation, weather and CV data…
                  </div>
                )}
              </div>
            </div>

            {/* Right rail */}
            <div className="space-y-5">
              <SidePanel title="Location" icon={<Navigation className="w-4 h-4 text-sky-500" />}>
                <p className="text-lg font-semibold text-slate-800">
                  {lat.toFixed(4)}° N, {lng.toFixed(4)}° E
                </p>
                <div className="grid grid-cols-2 gap-3 mt-3 text-xs text-slate-500">
                  <div>
                    <p className="text-[11px]">Altitude</p>
                    <p className="text-sm font-medium text-slate-700">{altitude} m</p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-[11px]">
                      <Calendar className="w-3 h-3" /> Captured
                    </p>
                    <p className="text-sm font-medium text-slate-700">{captured}</p>
                  </div>
                </div>
              </SidePanel>

              <SidePanel title="Weather" icon={<Cloud className="w-4 h-4 text-sky-500" />}>
                <div className="flex items-center gap-3">
                  <Cloud className="w-8 h-8 text-sky-400" />
                  <div>
                    <p className="text-2xl font-bold text-slate-800">{tempC}°C</p>
                    <p className="text-xs text-slate-500">{DEMO.condition}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <Droplet className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-sm font-medium text-slate-700">{humidity}%</span> Humidity
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Droplets className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-sm font-medium text-slate-700">{rainfall} mm</span> Rainfall
                  </div>
                </div>
              </SidePanel>

              <SidePanel title="Quick Insights">
                <ul className="space-y-2.5 text-sm text-slate-600">
                  <InsightRow color="bg-emerald-500">
                    Moderate vegetation density ({vegPct}%)
                  </InsightRow>
                  <InsightRow color="bg-amber-400">Low erosion risk in selected area</InsightRow>
                  <InsightRow color="bg-sky-500">
                    Watershed area {catchmentArea.toFixed(1)} sq km
                  </InsightRow>
                </ul>
              </SidePanel>
            </div>
          </div>

          {/* Detailed analysis */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-200">
              {ANALYSIS_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAnalysisTab(tab)}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    analysisTab === tab
                      ? 'border-sky-500 text-sky-600'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
              {/* Vegetation donut */}
              <div className="flex items-center gap-4">
                <DonutGauge percent={vegPct} />
                <div>
                  <p className="font-semibold text-slate-800">Vegetation Density</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[140px]">
                    Good vegetation cover across most of the area
                  </p>
                </div>
              </div>

              {/* NDVI trend chart */}
              <div>
                <p className="text-sm font-medium text-slate-600 mb-2">NDVI Trend (Last 7 days)</p>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={DEMO.ndviTrend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Line
                        type="monotone"
                        dataKey="ndvi"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 3, fill: '#10b981' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Satellite thumbnail */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex bg-slate-100 rounded-md p-0.5 text-xs">
                    {(['True Color', 'NDVI'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setSatelliteView(v)}
                        className={`px-2.5 py-1 rounded ${
                          satelliteView === v
                            ? 'bg-sky-500 text-white'
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="h-28 rounded-lg overflow-hidden relative">
                  {satelliteImage ? (
                    <img
                      src={`data:image/png;base64,${satelliteImage}`}
                      alt="Satellite thumbnail"
                      className="w-full h-full object-cover"
                    />
                  ) : satelliteView === 'NDVI' ? (
                    <div className="w-full h-full bg-gradient-to-br from-yellow-400 via-emerald-500 to-blue-700" />
                  ) : (
                    <img
                      src="/images/watershed-river.jpg"
                      alt="Watershed satellite true-color thumbnail"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  iconBg,
  label,
  value,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center ${iconBg}`}>{icon}</div>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-bold text-slate-800 mt-3">{value}</p>
      {children}
    </div>
  );
}

function SidePanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <p className="text-sm font-semibold text-slate-700">{title}</p>
      </div>
      {children}
    </div>
  );
}

function LayerCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 py-1 cursor-pointer text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-3.5 h-3.5 rounded accent-sky-500"
      />
      {label}
    </label>
  );
}

function InsightRow({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${color}`} />
      {children}
    </li>
  );
}

function DonutGauge({ percent }: { percent: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative w-20 h-20 shrink-0">
      <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="#10b981"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-800">
        {percent}%
      </div>
    </div>
  );
}

function Starfield() {
  // Deterministic pseudo-random star field so it doesn't shift between renders.
  const stars = Array.from({ length: 140 }).map((_, i) => {
    const seed = (i * 9301 + 49297) % 233280;
    const rand = seed / 233280;
    return {
      left: `${(rand * 137.5) % 100}%`,
      top: `${((rand * 971) % 100).toFixed(2)}%`,
      size: 1 + (i % 3),
      delay: `${(i % 5) * 0.6}s`,
    };
  });

  return (
    <div className="fixed inset-0 -z-10 bg-slate-950 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.08),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(16,185,129,0.06),transparent_50%)]" />
      {stars.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white animate-pulse"
          style={{
            left: s.left,
            top: s.top,
            width: s.size,
            height: s.size,
            opacity: 0.5,
            animationDelay: s.delay,
            animationDuration: '3s',
          }}
        />
      ))}
    </div>
  );
}

function TerrainTexture() {
  // Kept as a fallback pattern generator; not currently used since the map
  // now defaults to /images/watershed-river.jpg, but handy if you want a
  // procedural placeholder again later.
  return (
    <svg viewBox="0 0 700 420" className="absolute inset-0 w-full h-full">
      <defs>
        <radialGradient id="veg" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#166534" />
          <stop offset="100%" stopColor="#052e16" />
        </radialGradient>
      </defs>
      <rect width="700" height="420" fill="url(#veg)" />
      {Array.from({ length: 40 }).map((_, i) => (
        <circle
          key={i}
          cx={(i * 97) % 700}
          cy={(i * 53) % 420}
          r={6 + (i % 5)}
          fill="rgba(255,255,255,0.04)"
        />
      ))}
    </svg>
  );
}