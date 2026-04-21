# 🖨️ PhotoPrint — Network Photo Printer

A modern web application to upload photos and print them directly to your network printer via IPP or RAW (port 9100) protocol.

## Features

- **Drag & Drop Upload** — Drop images or browse to upload
- **Image Preview** — See your photo before printing with metadata display
- **Printer Configuration** — Configure printer IP, port, and protocol (IPP / RAW)
- **Print Controls** — Paper size (A4, A3, Letter, Legal, 4×6, 5×7), orientation, scaling, margins
- **Multiple Copies** — Print up to 99 copies
- **Job Tracking** — View print job status in real-time
- **Test Connection** — Verify printer connectivity before printing
- **Mobile Responsive** — Works on desktop, tablet, and mobile
- **Settings Persistence** — Printer config saved to localStorage

## Project Structure

```
print/
├── client/                # React frontend (Vite)
│   ├── src/
│   │   ├── App.jsx        # Main application component
│   │   ├── App.css        # App-level styles
│   │   ├── index.css      # Design system & global styles
│   │   └── main.jsx       # Entry point
│   ├── index.html
│   └── vite.config.js     # Vite config with API proxy
├── server/                # Express backend
│   ├── server.js          # API server with IPP/RAW printing
│   ├── package.json
│   └── uploads/           # Temporary image storage (auto-created)
└── README.md
```

## Setup Instructions

### Prerequisites
- Node.js 18+ installed
- A network printer accessible via IP address

### 1. Install Dependencies

```bash
# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### 2. Start the Backend Server

```bash
cd server
npm run dev
# Server runs on http://localhost:3001
```

### 3. Start the Frontend Dev Server

```bash
cd client
npm run dev
# App runs on http://localhost:5173
```

### 4. Configure Your Printer

1. Open http://localhost:5173
2. Enter your printer's IP address (e.g., `192.168.1.100`)
3. Select protocol:
   - **IPP** (port 631) — Most modern network printers
   - **RAW** (port 9100) — Direct TCP printing
4. Click "Test Connection" to verify

## Supported Formats

| Format | Extension |
|--------|-----------|
| JPEG   | .jpg, .jpeg |
| PNG    | .png |
| GIF    | .gif |
| BMP    | .bmp |
| TIFF   | .tiff |
| WebP   | .webp |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload an image |
| POST | `/api/print` | Send print job |
| POST | `/api/test-printer` | Test printer connectivity |
| GET | `/api/jobs` | List all print jobs |
| GET | `/api/jobs/:id` | Get specific job status |
| DELETE | `/api/upload/:filename` | Delete uploaded image |

## Troubleshooting

- **Printer not reachable**: Ensure the printer is on the same network and the IP is correct
- **IPP errors**: Try switching to RAW protocol (port 9100)
- **Large images slow**: Images are processed/resized server-side via Sharp before printing
