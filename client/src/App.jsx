import { useState, useCallback, useRef, useEffect } from 'react';
import heic2any from 'heic2any';
import './App.css';

const API_BASE = '';

function App() {
  const [uploadedFile, setUploadedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [testingPrinter, setTestingPrinter] = useState(false);

  const [printerIp, setPrinterIp] = useState(localStorage.getItem('printerIp') || '');
  const [printerPort, setPrinterPort] = useState(localStorage.getItem('printerPort') || '631');
  const [protocol, setProtocol] = useState(localStorage.getItem('protocol') || 'ipp');
  const [paperSize, setPaperSize] = useState('a4');
  const [orientation, setOrientation] = useState('portrait');
  const [copies, setCopies] = useState(1);
  const [scaling, setScaling] = useState('fit');
  const [margins, setMargins] = useState({ top: 10, right: 10, bottom: 10, left: 10 });

  const [thermalGamma, setThermalGamma] = useState(3.0);
  const [thermalContrast, setThermalContrast] = useState(1.0);
  const [thermalSharpen, setThermalSharpen] = useState(1.5);
  const [thermalDithering, setThermalDithering] = useState('floyd-steinberg');

  const [printJobs, setPrintJobs] = useState([]);

  const [openSections, setOpenSections] = useState({
    printer: true,
    page: true,
    copies: true,
    advanced: false,
    jobs: true,
    converter: true
  });

  const [activeTab, setActiveTab] = useState('print'); // 'print' or 'convert'
  const [convertFormat, setConvertFormat] = useState('png');
  const [convertQuality, setConvertQuality] = useState(90);
  const [converting, setConverting] = useState(false);

  // Toasts
  const [toasts, setToasts] = useState([]);

  const fileInputRef = useRef(null);

  // Save printer config to localStorage
  useEffect(() => {
    if (printerIp) localStorage.setItem('printerIp', printerIp);
    if (printerPort) localStorage.setItem('printerPort', printerPort);
    if (protocol) localStorage.setItem('protocol', protocol);
  }, [printerIp, printerPort, protocol]);

  // ============================================
  // Toast System
  // ============================================
  const showToast = useCallback((type, title, message) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleFileUpload = useCallback(async (file) => {
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp', 'image/heic', 'image/heif'];
    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
    
    console.log('Uploading file:', file.name, 'Type:', file.type);
    
    if (!allowedTypes.includes(file.type) && !isHeic) {
      showToast('error', 'Invalid File', `File type "${file.type || 'unknown'}" is not supported. Please upload an image.`);
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      showToast('error', 'File Too Large', 'Maximum file size is 50MB');
      return;
    }

    let fileToUpload = file;
    
    // Convert HEIC to JPEG on client side
    if (isHeic) {
      showToast('info', 'Processing HEIC', 'Optimizing your image for printing...');
      try {
        const convertedBlob = await heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.9
        });
        
        // Handle case where heic2any returns an array
        const finalBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
        
        // Create a new file object
        fileToUpload = new File(
          [finalBlob], 
          file.name.replace(/\.(heic|heif)$/i, '.jpg'), 
          { type: 'image/jpeg' }
        );
      } catch (err) {
        console.error('Client-side HEIC conversion failed:', err);
        showToast('error', 'HEIC Error', 'Could not process this HEIC file. Please try a different image.');
        return;
      }
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('image', fileToUpload);

      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setUploadedFile(data.file);
      showToast('success', 'Upload Complete', `${data.file.originalName} uploaded successfully`);
    } catch (error) {
      showToast('error', 'Upload Failed', error.message);
    } finally {
      setUploading(false);
    }
  }, [showToast]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  }, [handleFileUpload]);

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files[0];
    handleFileUpload(file);
    e.target.value = '';
  }, [handleFileUpload]);

  // ============================================
  // Remove Image
  // ============================================
  const handleRemoveImage = useCallback(async () => {
    if (!uploadedFile) return;

    try {
      await fetch(`${API_BASE}/api/upload/${uploadedFile.filename}`, { method: 'DELETE' });
    } catch (_) {
      // Ignore errors on cleanup
    }

    setUploadedFile(null);
    showToast('info', 'Image Removed', 'Ready for a new upload');
  }, [uploadedFile, showToast]);

  // ============================================
  // Test Printer
  // ============================================
  const handleTestPrinter = useCallback(async () => {
    if (!printerIp) {
      showToast('warning', 'Missing IP', 'Please enter a printer IP address');
      return;
    }

    setTestingPrinter(true);

    try {
      const res = await fetch(`${API_BASE}/api/test-printer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printerIp,
          printerPort: parseInt(printerPort),
          protocol
        }),
      });

      const data = await res.json();

      if (data.success) {
        showToast('success', 'Printer Online', `Connected to ${printerIp}`);
      } else {
        showToast('error', 'Printer Offline', data.error || 'Cannot reach printer');
      }
    } catch (error) {
      showToast('error', 'Connection Error', error.message);
    } finally {
      setTestingPrinter(false);
    }
  }, [printerIp, printerPort, protocol, showToast]);

  // ============================================
  // Print
  // ============================================
  const handlePrint = useCallback(async () => {
    if (!uploadedFile) {
      showToast('warning', 'No Image', 'Please upload an image first');
      return;
    }

    if (!printerIp) {
      showToast('warning', 'Missing Printer', 'Please configure your printer IP address');
      return;
    }

    setPrinting(true);

    try {
      const res = await fetch(`${API_BASE}/api/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: uploadedFile.id,
          filename: uploadedFile.filename,
          printerIp,
          printerPort: parseInt(printerPort),
          protocol,
          paperSize,
          orientation,
          copies,
          scaling,
          margins,
          thermalGamma,
          thermalContrast,
          thermalSharpen,
          thermalDithering
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.details || data.error || 'Print failed');
      }

      showToast('success', 'Print Job Sent!', `Job ID: ${data.jobId.substring(0, 8)}...`);

      // Refresh jobs list
      fetchJobs();
    } catch (error) {
      showToast('error', 'Print Failed', error.message);
    } finally {
      setPrinting(false);
    }
  }, [uploadedFile, printerIp, printerPort, protocol, paperSize, orientation, copies, scaling, margins, thermalGamma, thermalContrast, thermalSharpen, thermalDithering, showToast]);

  // ============================================
  // Image Converter
  // ============================================
  const handleConvert = useCallback(async () => {
    if (!uploadedFile) {
      showToast('warning', 'No Image', 'Please upload an image first');
      return;
    }

    setConverting(true);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      // Use the local URL for the image
      img.src = `${API_BASE}${uploadedFile.url}`;

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Failed to load image for conversion"));
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      let mimeType = `image/${convertFormat}`;
      // Special case for formats
      if (convertFormat === 'jpg') mimeType = 'image/jpeg';

      const quality = convertQuality / 100;
      
      canvas.toBlob((blob) => {
        if (!blob) {
          throw new Error("Failed to create image blob");
        }
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const baseName = uploadedFile.originalName.replace(/\.[^/.]+$/, "");
        link.download = `${baseName}.${convertFormat}`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        
        // Cleanup
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          setConverting(false);
          showToast('success', 'Conversion Success', `Downloaded as ${convertFormat.toUpperCase()}`);
        }, 100);
      }, mimeType, quality);

    } catch (error) {
      showToast('error', 'Conversion Failed', error.message);
      setConverting(false);
    }
  }, [uploadedFile, convertFormat, convertQuality, showToast]);

  // ============================================
  // Fetch Jobs
  // ============================================
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/jobs`);
      const data = await res.json();
      setPrintJobs(data);
    } catch (_) {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 10000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // ============================================
  // Helpers
  // ============================================
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const toggleSection = (section) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toastIcons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const jobStatusIcons = { completed: '✓', failed: '✕', processing: '⟳', sending: '↑' };

  // ============================================
  // Render
  // ============================================
  return (
    <div className="app">
      {/* Header */}
      <header className="header" id="app-header">
        <div className="header-logo">
          <div className="header-logo-icon">🖨️</div>
          <div>
            <h1>PhotoPrint</h1>
            <span>Network Photo Printer</span>
          </div>
        </div>
        <div className="header-status" id="printer-status">
          <div className={`status-dot ${printerIp ? '' : 'offline'}`}></div>
          {printerIp ? `Printer: ${printerIp}` : 'No printer configured'}
        </div>
      </header>

      {/* Main Layout */}
      <div className="app-layout">
        {/* Main Content Area */}
        <main className="main-content">
          {!uploadedFile ? (
            /* Upload Zone */
            <div
              id="upload-zone"
              className={`upload-zone ${isDragging ? 'drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="upload-zone-content">
                <div className="upload-icon">📷</div>
                <h2>Drop your photo here</h2>
                <p>or click to browse files from your device</p>
                <button className="upload-btn" type="button">
                  {uploading ? (
                    <>
                      <div className="spinner spinner-sm"></div>
                      Uploading...
                    </>
                  ) : (
                    <>📁 Choose File</>
                  )}
                </button>
                <div className="upload-formats">
                  Supports JPEG, PNG, HEIC, GIF, BMP, TIFF, WebP • Max 50MB
                </div>
              </div>
                <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                id="file-input"
              />
            </div>
          ) : (
            /* Image Preview */
            <div className="preview-container" id="image-preview">
              <div className="preview-header">
                <h3>🖼️ Image Preview</h3>
                <div className="preview-actions">
                  <button
                    className="preview-action-btn"
                    onClick={() => fileInputRef.current?.click()}
                    title="Upload new image"
                  >
                    🔄
                  </button>
                  <button
                    className="preview-action-btn danger"
                    onClick={handleRemoveImage}
                    title="Remove image"
                    id="remove-image-btn"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="preview-image-wrapper">
                <img
                  src={`${API_BASE}${uploadedFile.url}`}
                  alt={uploadedFile.originalName}
                  className={orientation === 'landscape' ? 'landscape' : ''}
                />
                {activeTab === 'convert' && (
                  <div className="preview-overlay">
                    <div className="conversion-badge">
                      CONVERSION MODE: {convertFormat.toUpperCase()}
                    </div>
                  </div>
                )}
              </div>

              <div className="preview-info">
                <div className="preview-info-item">
                  📄 <span>{uploadedFile.originalName}</span>
                </div>
                <div className="preview-info-item">
                  📐 <span>{uploadedFile.width} × {uploadedFile.height}px</span>
                </div>
                <div className="preview-info-item">
                  💾 <span>{formatFileSize(uploadedFile.size)}</span>
                </div>
                <div className="preview-info-item">
                  🎨 <span>{uploadedFile.mimetype.split('/')[1].toUpperCase()}</span>
                </div>
              </div>

                <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic,.heif"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
          )}
        </main>

        {/* Sidebar - Tools */}
        <aside className="sidebar" id="print-settings">
          {/* Tab Switcher */}
          <div className="tab-switcher">
            <button
              className={`tab-btn ${activeTab === 'print' ? 'active' : ''}`}
              onClick={() => setActiveTab('print')}
            >
              🖨️ Printer
            </button>
            <button
              className={`tab-btn ${activeTab === 'convert' ? 'active' : ''}`}
              onClick={() => setActiveTab('convert')}
            >
              🔄 Converter
            </button>
          </div>

          {activeTab === 'print' ? (
            <>
              {/* Printer Configuration */}
          <div className="sidebar-card">
            <div className="sidebar-card-header" onClick={() => toggleSection('printer')}>
              <h3>🖨️ Printer</h3>
              <span className={`chevron ${openSections.printer ? 'open' : ''}`}>▼</span>
            </div>
            {openSections.printer && (
              <div className="sidebar-card-body">
                <div className="form-group">
                  <label className="form-label">{protocol === 'system' ? 'Printer Queue Name (System)' : 'Printer IP Address'}</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={protocol === 'system' ? 'e.g. Canon_MF4700_Series' : 'e.g. 192.168.1.100'}
                    value={printerIp}
                    onChange={(e) => setPrinterIp(e.target.value)}
                    id="printer-ip-input"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Protocol</label>
                    <select
                      className="form-select"
                      value={protocol}
                      onChange={(e) => {
                        const newProto = e.target.value;
                        setProtocol(newProto);
                        if (newProto === 'raw' || newProto === 'thermal') {
                          setPrinterPort('9100');
                        } else {
                          setPrinterPort('631');
                        }
                      }}
                      id="protocol-select"
                    >
                      <option value="ipp">IPP</option>
                      <option value="raw">RAW (9100)</option>
                      <option value="thermal">Thermal (ESC/POS)</option>
                      <option value="system">System Printer (CUPS/OS)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Port</label>
                    <input
                      type="text"
                      className="form-input"
                      value={printerPort}
                      onChange={(e) => setPrinterPort(e.target.value)}
                      id="printer-port-input"
                    />
                  </div>
                </div>

                <button
                  className="btn btn-test"
                  onClick={handleTestPrinter}
                  disabled={testingPrinter || !printerIp}
                  id="test-printer-btn"
                >
                  {testingPrinter ? (
                    <><div className="spinner spinner-sm"></div> Testing...</>
                  ) : (
                    <>🔌 Test Connection</>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Page Settings */}
          <div className="sidebar-card">
            <div className="sidebar-card-header" onClick={() => toggleSection('page')}>
              <h3>📄 Page Setup</h3>
              <span className={`chevron ${openSections.page ? 'open' : ''}`}>▼</span>
            </div>
            {openSections.page && (
              <div className="sidebar-card-body">
                <div className="form-group">
                  <label className="form-label">Paper Size</label>
                  <select
                    className="form-select"
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value)}
                    id="paper-size-select"
                  >
                    <option value="a4">A4 (210 × 297mm)</option>
                    <option value="a3">A3 (297 × 420mm)</option>
                    <option value="letter">Letter (8.5 × 11in)</option>
                    <option value="legal">Legal (8.5 × 14in)</option>
                    <option value="4x6">4×6 Photo</option>
                    <option value="5x7">5×7 Photo</option>
                    <option value="80mm">80mm Thermal</option>
                    <option value="58mm">58mm Thermal</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Orientation</label>
                  <div className="orientation-toggle">
                    <button
                      className={`orientation-option ${orientation === 'portrait' ? 'active' : ''}`}
                      onClick={() => setOrientation('portrait')}
                      id="orientation-portrait"
                    >
                      <div className="orientation-icon"></div>
                      Portrait
                    </button>
                    <button
                      className={`orientation-option ${orientation === 'landscape' ? 'active' : ''}`}
                      onClick={() => setOrientation('landscape')}
                      id="orientation-landscape"
                    >
                      <div className="orientation-icon landscape"></div>
                      Landscape
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Scaling</label>
                  <select
                    className="form-select"
                    value={scaling}
                    onChange={(e) => setScaling(e.target.value)}
                    id="scaling-select"
                  >
                    <option value="fit">Fit to Page</option>
                    <option value="fill">Fill Page (Crop)</option>
                    <option value="none">Original Size</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Margins (mm)</label>
                  <div className="margins-grid">
                    <div className="form-group">
                      <label className="form-label">Top</label>
                      <input
                        type="number"
                        className="form-input"
                        value={margins.top}
                        min="0"
                        max="50"
                        onChange={(e) => setMargins(m => ({ ...m, top: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Right</label>
                      <input
                        type="number"
                        className="form-input"
                        value={margins.right}
                        min="0"
                        max="50"
                        onChange={(e) => setMargins(m => ({ ...m, right: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Bottom</label>
                      <input
                        type="number"
                        className="form-input"
                        value={margins.bottom}
                        min="0"
                        max="50"
                        onChange={(e) => setMargins(m => ({ ...m, bottom: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Left</label>
                      <input
                        type="number"
                        className="form-input"
                        value={margins.left}
                        min="0"
                        max="50"
                        onChange={(e) => setMargins(m => ({ ...m, left: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Copies */}
          <div className="sidebar-card">
            <div className="sidebar-card-header" onClick={() => toggleSection('copies')}>
              <h3>📋 Copies</h3>
              <span className={`chevron ${openSections.copies ? 'open' : ''}`}>▼</span>
            </div>
            {openSections.copies && (
              <div className="sidebar-card-body">
                <div className="copies-control">
                  <button
                    className="copies-btn"
                    onClick={() => setCopies(c => Math.max(1, c - 1))}
                    disabled={copies <= 1}
                  >
                    −
                  </button>
                  <span className="copies-count">{copies}</span>
                  <button
                    className="copies-btn"
                    onClick={() => setCopies(c => Math.min(99, c + 1))}
                    disabled={copies >= 99}
                  >
                    +
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Advanced Printing */}
          <div className="sidebar-card">
            <div className="sidebar-card-header" onClick={() => toggleSection('advanced')}>
              <h3>⚙️ Advanced Printing</h3>
              <span className={`chevron ${openSections.advanced ? 'open' : ''}`}>▼</span>
            </div>
            {openSections.advanced && (
              <div className="sidebar-card-body">
                <div className="form-group">
                  <label className="form-label">Intensity: {thermalGamma.toFixed(1)}</label>
                  <input
                    type="range"
                    className="form-range"
                    min="0.5"
                    max="5.0"
                    step="0.1"
                    value={thermalGamma}
                    onChange={(e) => setThermalGamma(parseFloat(e.target.value))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Contrast: {thermalContrast.toFixed(1)}</label>
                  <input
                    type="range"
                    className="form-range"
                    min="0.5"
                    max="2.5"
                    step="0.1"
                    value={thermalContrast}
                    onChange={(e) => setThermalContrast(parseFloat(e.target.value))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Sharpness: {thermalSharpen.toFixed(1)}</label>
                  <input
                    type="range"
                    className="form-range"
                    min="0"
                    max="10"
                    step="0.5"
                    value={thermalSharpen}
                    onChange={(e) => setThermalSharpen(parseFloat(e.target.value))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Dithering</label>
                  <select
                    className="form-select"
                    value={thermalDithering}
                    onChange={(e) => setThermalDithering(e.target.value)}
                  >
                    <option value="floyd-steinberg">Smooth</option>
                    <option value="atkinson">Atkinson (Sharp)</option>
                    <option value="bayer">Bayer</option>
                    <option value="threshold">B&W Only</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Print Button */}
          <button
            className="btn btn-primary btn-print"
            onClick={handlePrint}
            disabled={!uploadedFile || !printerIp || printing}
            id="print-btn"
          >
            {printing ? (
              <><div className="spinner"></div> Sending to printer...</>
            ) : (
              <>🖨️ Print Photo</>
            )}
          </button>
        </>
      ) : (
        <>
          {/* Image Converter */}
          <div className="sidebar-card">
            <div className="sidebar-card-header" onClick={() => toggleSection('converter')}>
              <h3>🔄 Image Converter</h3>
              <span className={`chevron ${openSections.converter ? 'open' : ''}`}>▼</span>
            </div>
            {openSections.converter && (
              <div className="sidebar-card-body">
                <div className="form-group">
                  <label className="form-label">Target Format</label>
                  <select
                    className="form-select"
                    value={convertFormat}
                    onChange={(e) => setConvertFormat(e.target.value)}
                    id="convert-format-select"
                  >
                    <option value="png">PNG (Lossless)</option>
                    <option value="jpg">JPEG (Compressed)</option>
                    <option value="webp">WebP (Modern)</option>
                    <option value="bmp">BMP (Windows)</option>
                  </select>
                  <p className="form-help">
                    {convertFormat === 'png' && "Best for graphics and transparent images."}
                    {convertFormat === 'jpg' && "Best for photos and small file sizes."}
                    {convertFormat === 'webp' && "Excellent compression with high quality."}
                    {convertFormat === 'bmp' && "Uncompressed legacy format."}
                  </p>
                </div>

                {(convertFormat === 'jpg' || convertFormat === 'webp') && (
                  <div className="form-group">
                    <label className="form-label">Quality: {convertQuality}%</label>
                    <input
                      type="range"
                      className="form-range"
                      min="10"
                      max="100"
                      step="1"
                      value={convertQuality}
                      onChange={(e) => setConvertQuality(parseInt(e.target.value))}
                    />
                  </div>
                )}

                <div className="converter-info">
                  <div className="info-badge">
                    <span>Current:</span>
                    <strong>{uploadedFile?.mimetype?.split('/')[1]?.toUpperCase() || 'NONE'}</strong>
                  </div>
                  <div className="info-arrow">➜</div>
                  <div className="info-badge highlight">
                    <span>Target:</span>
                    <strong>{convertFormat.toUpperCase()}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            className="btn btn-primary btn-print"
            onClick={handleConvert}
            disabled={!uploadedFile || converting}
            id="convert-btn"
          >
            {converting ? (
              <><div className="spinner"></div> Converting...</>
            ) : (
              <>🔄 Convert & Download</>
            )}
          </button>
        </>
      )}

      {/* Print Jobs */}
      <div className="sidebar-card">
            <div className="sidebar-card-header" onClick={() => toggleSection('jobs')}>
              <h3>📃 Print Jobs</h3>
              <span className={`chevron ${openSections.jobs ? 'open' : ''}`}>▼</span>
            </div>
            {openSections.jobs && (
              <div className="sidebar-card-body" style={{ padding: printJobs.length ? '8px' : undefined }}>
                {printJobs.length === 0 ? (
                  <div className="jobs-empty">
                    <div className="jobs-empty-icon">📭</div>
                    <p>No print jobs yet</p>
                  </div>
                ) : (
                  <div className="jobs-list">
                    {printJobs.map(job => (
                      <div className="job-item" key={job.id}>
                        <div className={`job-status-icon ${job.status}`}>
                          {jobStatusIcons[job.status] || '?'}
                        </div>
                        <div className="job-info">
                          <h4>{job.filename}</h4>
                          <p>
                            {job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                            {job.copies > 1 ? ` • ${job.copies} copies` : ''}
                            {' • '}{job.paperSize?.toUpperCase()}
                          </p>
                        </div>
                        <div className="job-time">{formatTime(job.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Toast Notifications */}
      <div className="toast-container" id="toast-container">
        {toasts.map(toast => (
          <div className={`toast ${toast.type}`} key={toast.id}>
            <div className="toast-icon">{toastIcons[toast.type]}</div>
            <div className="toast-content">
              <h4>{toast.title}</h4>
              {toast.message && <p>{toast.message}</p>}
            </div>
            <button className="toast-close" onClick={() => removeToast(toast.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
