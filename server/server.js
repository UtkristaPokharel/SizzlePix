const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const net = require('net');
const ipp = require('ipp');
const EscPosEncoder = require('esc-pos-encoder');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp', 'image/heic', 'image/heif'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.heic') || file.originalname.toLowerCase().endsWith('.heif')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

// Store print jobs in memory
const printJobs = new Map();

// ============================================
// ROUTES
// ============================================

// Upload image
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // If it's a HEIC/HEIF file, convert it to JPEG for browser compatibility
    let finalPath = req.file.path;
    let finalFilename = req.file.filename;
    let finalMimetype = req.file.mimetype;

    if (req.file.mimetype === 'image/heic' || req.file.mimetype === 'image/heif' || req.file.filename.toLowerCase().endsWith('.heic') || req.file.filename.toLowerCase().endsWith('.heif')) {
      try {
        const jpegFilename = `${path.basename(req.file.filename, path.extname(req.file.filename))}.jpg`;
        const jpegPath = path.join(uploadsDir, jpegFilename);
        
        console.log(`   🔄 Converting HEIC to JPEG: ${req.file.filename} -> ${jpegFilename}`);
        
        await sharp(req.file.path)
          .toFormat('jpeg')
          .toFile(jpegPath);
        
        // Remove original HEIC file
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        
        finalPath = jpegPath;
        finalFilename = jpegFilename;
        finalMimetype = 'image/jpeg';
      } catch (convError) {
        console.error('HEIC conversion error:', convError);
        // If conversion fails, it might be due to missing libheif in sharp
        return res.status(500).json({ 
          error: 'HEIC format not supported by server', 
          details: 'The server lacks the necessary libraries to process HEIC images. Please upload JPEG or PNG instead.' 
        });
      }
    }

    // Get image metadata using sharp
    const metadata = await sharp(finalPath).metadata();

    res.json({
      success: true,
      file: {
        id: path.basename(finalFilename, path.extname(finalFilename)),
        filename: finalFilename,
        originalName: req.file.originalname,
        size: fs.statSync(finalPath).size,
        mimetype: finalMimetype,
        width: metadata.width,
        height: metadata.height,
        url: `/uploads/${finalFilename}`
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Print image via IPP
app.post('/api/print', async (req, res) => {
  try {
    const {
      fileId,
      filename,
      printerIp,
      printerPort = 631,
      protocol = 'ipp',
      paperSize = 'a4',
      orientation = 'portrait',
      copies = 1,
      scaling = 'fit',
      margins = { top: 10, right: 10, bottom: 10, left: 10 },
      // Advanced thermal settings
      thermalGamma = 2.2,
      thermalContrast = 1.0,
      thermalSharpen = 1.5,
      thermalDithering = 'floyd-steinberg',
      thermalDensity = 1 // 0-15 (depends on printer)
    } = req.body;

    console.log(`\n🖨️  New Print Job:`);
    console.log(`   File: ${filename}`);
    console.log(`   Printer: ${printerIp}:${printerPort} (${protocol})`);
    console.log(`   Settings: ${paperSize}, ${orientation}, ${copies} copy(ies)`);

    if (!filename || !printerIp) {
      return res.status(400).json({ error: 'Filename and printer IP are required' });
    }

    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Image file not found' });
    }

    const jobId = uuidv4();

    // Update job status
    printJobs.set(jobId, {
      id: jobId,
      filename,
      printerIp,
      status: 'processing',
      createdAt: new Date().toISOString(),
      copies,
      paperSize,
      orientation
    });

    // Process image with sharp for print optimization
    let imageProcessor = sharp(filePath);

    // Get paper dimensions in pixels (300 DPI)
    const paperDimensions = getPaperDimensions(paperSize, orientation);
    const marginPx = {
      top: Math.round(margins.top * 300 / 25.4),
      right: Math.round(margins.right * 300 / 25.4),
      bottom: Math.round(margins.bottom * 300 / 25.4),
      left: Math.round(margins.left * 300 / 25.4)
    };

    const printableWidth = paperDimensions.width - marginPx.left - marginPx.right;
    const printableHeight = paperDimensions.height - marginPx.top - marginPx.bottom;

    if (scaling === 'fit') {
      imageProcessor = imageProcessor.resize(printableWidth, printableHeight, {
        fit: 'inside',
        withoutEnlargement: false
      });
    } else if (scaling === 'fill') {
      imageProcessor = imageProcessor.resize(printableWidth, printableHeight, {
        fit: 'cover'
      });
    }

    // Convert based on protocol
    let processedBuffer;

    if (protocol === 'thermal' || (protocol === 'raw' && (paperSize === '80mm' || paperSize === '58mm'))) {
      if (protocol === 'raw') console.log('   ⚠️  Auto-switching to Thermal (ESC/POS) mode for receipt paper size');
      
      const thermalWidth = paperSize === '58mm' ? 384 : 576; // Default to 80mm (576px)

      const thermalProcessor = sharp(filePath);
      const metadata = await thermalProcessor.metadata();

      const aspectRatio = metadata.height / metadata.width;
      let thermalHeight = Math.round(thermalWidth * aspectRatio);
      thermalHeight = Math.max(8, Math.floor(thermalHeight / 8) * 8);

      const { data, info } = await thermalProcessor
        .resize(thermalWidth, thermalHeight, { fit: 'fill' })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .greyscale()
        .normalize() // Initial normalization
        .linear(thermalContrast, -(thermalContrast - 1) / 2) // Adjust contrast
        .gamma(thermalGamma) // Apply custom gamma
        .sharpen({ sigma: thermalSharpen }) // Apply custom sharpening
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      console.log(`   Internal Step: Image processed to ${info.width}x${info.height} with gamma=${thermalGamma}, contrast=${thermalContrast}, sharpen=${thermalSharpen}`);

      const encoder = new EscPosEncoder();
      let result = encoder
        .initialize()
        .align('center');

      // Increase print density if possible (Common ESC/POS command)
      // GS ( K <pL> <pH> n m => Set print density
      // This is a bit advanced, but we can try sending it raw
      if (thermalDensity > 0) {
        // Many printers use 0x1D 0x28 0x4B 0x02 0x00 0x31 <m> where m is density 0-255 or 0-10
        // We'll use a simpler common one or let the encoder handle it if it could.
        // Since encoder doesn't have a density() method, we'll manually prepend if needed.
      }

      let rgbaData;
      if (info.channels === 4) {
        rgbaData = new Uint8ClampedArray(data);
      } else {
        rgbaData = new Uint8ClampedArray(info.width * info.height * 4).fill(255);
        for (let i = 0; i < info.width * info.height; i++) {
          const srcIdx = i * info.channels;
          const dstIdx = i * 4;
          rgbaData[dstIdx] = data[srcIdx];
          rgbaData[dstIdx + 1] = data[srcIdx + 1] || data[srcIdx];
          rgbaData[dstIdx + 2] = data[srcIdx + 2] || data[srcIdx];
          rgbaData[dstIdx + 3] = 255;
        }
      }

      result.image({
        data: rgbaData,
        width: info.width,
        height: info.height
      }, info.width, info.height, thermalDithering);

      processedBuffer = result
        .newline()
        .newline()
        .newline()
        .newline()
        .cut()
        .encode();
    } else {
      // Standard printing (Inkjet/Laser)
      processedBuffer = await imageProcessor
        .jpeg({ quality: 95 })
        .toBuffer();
    }

    // Try printing based on protocol
    if (protocol === 'system') {
      try {
        await printSystem(printerIp, processedBuffer, jobId, { copies });
      } catch (sysErr) {
        throw new Error(`System printing failed: ${sysErr.message}`);
      }
    } else if (protocol === 'raw' || protocol === 'thermal') {
      // RAW or Thermal protocol (direct socket)
      try {
        await printRaw(printerIp, printerPort || 9100, processedBuffer, jobId);
      } catch (connErr) {
        throw new Error(`Printer connection failed: ${connErr.message}`);
      }
    } else {
      // IPP protocol
      try {
        await printIPP(printerIp, printerPort || 631, processedBuffer, jobId, {
          copies,
          paperSize,
          orientation
        });
      } catch (ippErr) {
        throw new Error(`IPP printing failed: ${ippErr.message}`);
      }
    }

    res.json({
      success: true,
      jobId,
      message: 'Print job submitted successfully'
    });
  } catch (error) {
    console.error('Print error detailed:', error);
    res.status(500).json({
      error: 'Failed to send print job',
      details: error.message
    });
  }
});

// Get print job status
app.get('/api/jobs/:jobId', (req, res) => {
  const job = printJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Get all print jobs
app.get('/api/jobs', (req, res) => {
  const jobs = Array.from(printJobs.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(jobs);
});

// Test printer connectivity
app.post('/api/test-printer', async (req, res) => {
  const { printerIp, printerPort = 9100, protocol = 'ipp' } = req.body;

  if (!printerIp) {
    return res.status(400).json({ error: 'Printer IP is required' });
  }

  try {
    if (protocol === 'raw') {
      await testRawConnection(printerIp, printerPort || 9100);
    } else if (protocol === 'system') {
      await new Promise((resolve, reject) => {
        require('child_process').execFile('lpstat', ['-p', printerIp], (error) => {
          if (error) reject(new Error(`System printer "${printerIp}" not found`));
          else resolve();
        });
      });
    } else {
      await testIPPConnection(printerIp, printerPort || 631);
    }
    res.json({ success: true, message: 'Printer is reachable' });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: `Printer unreachable: ${error.message}`
    });
  }
});

// Delete uploaded image
app.delete('/api/upload/:filename', (req, res) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// ============================================
// PRINTING FUNCTIONS
// ============================================

// Print via System OS (CUPS/lp)
function printSystem(printerName, buffer, jobId, options) {
  return new Promise((resolve, reject) => {
    const tempFilePath = path.join(uploadsDir, `temp_${jobId}.jpg`);
    fs.writeFileSync(tempFilePath, buffer);
    
    printJobs.set(jobId, { ...printJobs.get(jobId), status: 'sending' });
    
    const args = ['-d', printerName];
    if (options.copies > 1) {
      args.push('-n', options.copies.toString());
    }
    args.push(tempFilePath);
    
    require('child_process').execFile('lp', args, (error, stdout, stderr) => {
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
      
      if (error) {
        printJobs.set(jobId, { ...printJobs.get(jobId), status: 'failed', error: stderr || error.message });
        reject(error);
      } else {
        printJobs.set(jobId, { ...printJobs.get(jobId), status: 'completed', completedAt: new Date().toISOString(), printerResponse: stdout });
        resolve(stdout);
      }
    });
  });
}

// Get paper dimensions at 300 DPI
function getPaperDimensions(paperSize, orientation) {
  const sizes = {
    'a4': { width: 2480, height: 3508 },      // 210 x 297 mm
    'a3': { width: 3508, height: 4961 },      // 297 x 420 mm
    'letter': { width: 2550, height: 3300 },   // 8.5 x 11 in
    'legal': { width: 2550, height: 4200 },    // 8.5 x 14 in
    '4x6': { width: 1200, height: 1800 },     // 4 x 6 in (photo)
    '5x7': { width: 1500, height: 2100 },     // 5 x 7 in (photo)
    '80mm': { width: 576, height: 2000 },     // Thermal 80mm
    '58mm': { width: 384, height: 2000 },     // Thermal 58mm
  };

  let dims = sizes[paperSize] || sizes['a4'];

  if (orientation === 'landscape') {
    dims = { width: dims.height, height: dims.width };
  }

  return dims;
}

// Print via RAW socket (port 9100)
function printRaw(ip, port, buffer, jobId) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const timeout = setTimeout(() => {
      client.destroy();
      printJobs.set(jobId, { ...printJobs.get(jobId), status: 'failed', error: 'Connection timeout' });
      reject(new Error('Connection timeout'));
    }, 10000);

    client.connect(port, ip, () => {
      clearTimeout(timeout);
      printJobs.set(jobId, { ...printJobs.get(jobId), status: 'sending' });

      client.write(buffer, () => {
        client.end();
        printJobs.set(jobId, { ...printJobs.get(jobId), status: 'completed', completedAt: new Date().toISOString() });
        resolve();
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      printJobs.set(jobId, { ...printJobs.get(jobId), status: 'failed', error: err.message });
      reject(err);
    });
  });
}

// Print via IPP protocol
function printIPP(ip, port, buffer, jobId, options) {
  return new Promise((resolve, reject) => {
    const printerUrl = `ipp://${ip}:${port}/ipp/print`;
    const printer = ipp.Printer(printerUrl);

    const orientationMap = {
      'portrait': 'portrait',
      'landscape': 'landscape'
    };

    const mediaSizeMap = {
      'a4': 'iso_a4_210x297mm',
      'a3': 'iso_a3_297x420mm',
      'letter': 'na_letter_8.5x11in',
      'legal': 'na_legal_8.5x14in',
      '4x6': 'na_index-4x6_4x6in',
      '5x7': 'na_5x7_5x7in'
    };

    const msg = {
      'operation-attributes-tag': {
        'requesting-user-name': 'PhotoPrint',
        'job-name': `Photo_${jobId.substring(0, 8)}`,
        'document-format': 'image/jpeg'
      },
      'job-attributes-tag': {
        'copies': options.copies || 1,
        'orientation-requested': orientationMap[options.orientation] || 'portrait',
        'media': mediaSizeMap[options.paperSize] || 'iso_a4_210x297mm'
      },
      data: buffer
    };

    printJobs.set(jobId, { ...printJobs.get(jobId), status: 'sending' });

    printer.execute('Print-Job', msg, (err, result) => {
      if (err) {
        printJobs.set(jobId, { ...printJobs.get(jobId), status: 'failed', error: err.message });
        reject(err);
      } else {
        printJobs.set(jobId, {
          ...printJobs.get(jobId),
          status: 'completed',
          completedAt: new Date().toISOString(),
          printerResponse: result
        });
        resolve(result);
      }
    });
  });
}

// Test RAW connection
function testRawConnection(ip, port) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Connection timeout'));
    }, 5000);

    client.connect(port, ip, () => {
      clearTimeout(timeout);
      client.destroy();
      resolve(true);
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Test IPP connection
function testIPPConnection(ip, port) {
  return new Promise((resolve, reject) => {
    const printerUrl = `ipp://${ip}:${port}/ipp/print`;
    const printer = ipp.Printer(printerUrl);

    printer.execute('Get-Printer-Attributes', null, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🖨️  Print Server running at http://localhost:${PORT}`);
  console.log(`📁 Uploads directory: ${uploadsDir}\n`);
});
