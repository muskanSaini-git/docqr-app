import React, { useState, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { PDFDocument } from 'pdf-lib';
import { scanAndCropDocument } from './scanUtils';
import './App.css';

const SERVER = process.env.REACT_APP_SERVER_URL || 'https://docqr-server.onrender.com';

// Convert image blob to a single-page PDF
async function imageToPdf(imageBlob) {
  const pdfDoc = await PDFDocument.create();
  const arrayBuffer = await imageBlob.arrayBuffer();
  const isJpeg = imageBlob.type === 'image/jpeg';
  const img = isJpeg
    ? await pdfDoc.embedJpg(arrayBuffer)
    : await pdfDoc.embedPng(arrayBuffer);
  const page = pdfDoc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  const bytes = await pdfDoc.save();
  return new File([bytes], `scan-${Date.now()}.pdf`, { type: 'application/pdf' });
}

function App() {
  const [files, setFiles] = useState([]);
  const [shareUrl, setShareUrl] = useState(() => localStorage.getItem('lastShareUrl') || null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null); // { url, blob, name }

  const fileInputRef = useRef();
  const cameraInputRef = useRef();
  const qrRef = useRef();

  // Handle PDF file upload
  const handleFileChange = (e) => {
    const pdfs = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
    if (pdfs.length === 0) { setError('Only PDF files are supported here. Use camera for images.'); return; }
    setFiles(prev => [...prev, ...pdfs]);
    setError('');
    e.target.value = '';
  };

  // Handle camera capture — auto crop + show preview
  const handleCameraCapture = async (e) => {
    const imageFile = e.target.files[0];
    if (!imageFile) return;
    e.target.value = '';
    setScanning(true);
    setError('');
    try {
      const croppedBlob = await scanAndCropDocument(imageFile);
      const previewUrl = URL.createObjectURL(croppedBlob);
      setPreview({ url: previewUrl, blob: croppedBlob, name: `scan-${Date.now()}.pdf` });
    } catch {
      setError('Could not process image. Please try again.');
    }
    setScanning(false);
  };

  // Confirm scanned image → convert to PDF and add to list
  const confirmScan = async () => {
    if (!preview) return;
    setScanning(true);
    try {
      const pdfFile = await imageToPdf(preview.blob);
      setFiles(prev => [...prev, pdfFile]);
      URL.revokeObjectURL(preview.url);
      setPreview(null);
    } catch {
      setError('Failed to convert image to PDF.');
    }
    setScanning(false);
  };

  const cancelScan = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const removeFile = (index) => setFiles(prev => prev.filter((_, i) => i !== index));

  const clearQR = () => {
    setShareUrl(null);
    localStorage.removeItem('lastShareUrl');
    setFiles([]);
    setError('');
  };

  const handleMergeAndUpload = async () => {
    if (files.length === 0) { setError('Please add at least one file.'); return; }
    setLoading(true);
    setError('');
    try {
      const mergedPdf = await PDFDocument.create();
      for (const file of files) {
        const bytes = await file.arrayBuffer();
        const pdf = await PDFDocument.load(bytes);
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(p => mergedPdf.addPage(p));
      }
      const blob = new Blob([await mergedPdf.save()], { type: 'application/pdf' });
      const formData = new FormData();
      formData.append('pdf', blob, 'merged.pdf');
      const res = await fetch(`${SERVER}/upload`, { method: 'POST', body: formData });
      const { shareUrl: url } = await res.json();
      setShareUrl(url);
      localStorage.setItem('lastShareUrl', url);
    } catch {
      setError('Connection failed. Make sure the server is running.');
    }
    setLoading(false);
  };

  const downloadQR = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'qr-code.png';
    link.href = canvas.toDataURL();
    link.click();
  };

  const formatSize = (bytes) => bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="app">
      {/* Scan Preview Modal */}
      {preview && (
        <div className="modal-overlay">
          <div className="modal">
            <h3 className="modal-title">📷 Scanned Document</h3>
            <p className="modal-sub">Extra space has been cropped. Looks good?</p>
            <div className="modal-img-wrap">
              <img src={preview.url} alt="Scanned document" className="modal-img" />
            </div>
            <div className="modal-actions">
              <button className="btn-green" onClick={confirmScan} disabled={scanning}>
                {scanning ? '⏳ Converting...' : '✅ Add to List'}
              </button>
              <button className="btn-red" onClick={cancelScan}>✕ Retake</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">📄</span>
            <span className="logo-text">DocQR</span>
          </div>
          <p className="header-tagline">Scan, Merge & Share Documents via QR Code</p>
        </div>
      </header>

      <main className="main">
        {/* Steps */}
        <div className="steps">
          <div className={`step ${files.length > 0 ? 'done' : 'active'}`}>
            <div className="step-num">1</div>
            <span>Upload / Scan</span>
          </div>
          <div className="step-line" />
          <div className={`step ${loading ? 'active' : shareUrl ? 'done' : ''}`}>
            <div className="step-num">2</div>
            <span>Merge</span>
          </div>
          <div className="step-line" />
          <div className={`step ${shareUrl ? 'done' : ''}`}>
            <div className="step-num">3</div>
            <span>Share QR</span>
          </div>
        </div>

        <div className="content-grid">
          {/* Left Panel */}
          <div className="panel">
            <h2 className="panel-title">Upload Documents</h2>

            {/* Upload Options */}
            <div className="upload-options">
              {/* PDF Upload */}
              <div
                className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
                onClick={() => fileInputRef.current.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault();
                  setDragOver(false);
                  const pdfs = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
                  setFiles(prev => [...prev, ...pdfs]);
                }}
              >
                <div className="drop-icon">📁</div>
                <p className="drop-title">Upload PDF</p>
                <p className="drop-sub">Click or drag & drop</p>
                <input ref={fileInputRef} type="file" accept="application/pdf" multiple style={{ display: 'none' }} onChange={handleFileChange} />
              </div>

              {/* Camera Scan */}
              <div className="drop-zone camera-zone" onClick={() => cameraInputRef.current.click()}>
                {scanning ? (
                  <>
                    <div className="drop-icon"><span className="spinner dark" /></div>
                    <p className="drop-title">Scanning...</p>
                    <p className="drop-sub">Cropping document</p>
                  </>
                ) : (
                  <>
                    <div className="drop-icon">📷</div>
                    <p className="drop-title">Scan Document</p>
                    <p className="drop-sub">Use phone camera</p>
                  </>
                )}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handleCameraCapture}
                />
              </div>
            </div>

            {/* File List */}
            {files.length > 0 && (
              <div className="file-section">
                <div className="file-header">
                  <span className="file-count">{files.length} file{files.length > 1 ? 's' : ''} · {formatSize(totalSize)}</span>
                  <button className="link-btn" onClick={() => setFiles([])}>Clear all</button>
                </div>
                <ul className="file-list">
                  {files.map((file, i) => (
                    <li key={i} className="file-item">
                      <div className="file-info">
                        <span className="file-icon">{file.name.startsWith('scan-') ? '📷' : '📄'}</span>
                        <div>
                          <p className="file-name">{file.name.startsWith('scan-') ? `Scanned Page ${i + 1}` : file.name}</p>
                          <p className="file-size">{formatSize(file.size)}</p>
                        </div>
                      </div>
                      <button className="remove-btn" onClick={() => removeFile(i)}>✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <div className="error-box">⚠️ {error}</div>}

            <button className="merge-btn" onClick={handleMergeAndUpload} disabled={loading || files.length === 0}>
              {loading
                ? <span className="btn-loading"><span className="spinner" />Processing...</span>
                : '🔗 Merge & Generate QR Code'
              }
            </button>
          </div>

          {/* Right Panel - QR */}
          <div className="panel qr-panel">
            <h2 className="panel-title">Your QR Code</h2>
            {shareUrl ? (
              <div className="qr-section">
                <div className="qr-badge">✅ Ready to Share</div>
                <div className="qr-wrapper" ref={qrRef}>
                  <QRCodeCanvas value={shareUrl} size={200} level="H" includeMargin />
                </div>
                <p className="qr-hint">Scan with any phone camera to open the merged PDF</p>
                <div className="url-box">
                  <span className="url-text">{shareUrl}</span>
                  <button className="copy-btn" onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy</button>
                </div>
                <div className="action-btns">
                  <button className="btn-green" onClick={downloadQR}>⬇️ Download QR</button>
                  <button className="btn-red" onClick={clearQR}>🗑️ Clear</button>
                </div>
              </div>
            ) : (
              <div className="qr-empty">
                <div className="qr-placeholder">
                  <div className="qr-placeholder-icon">📱</div>
                  <p>Your QR code will appear here after merging</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>DocQR — Scan, Merge & Share PDFs instantly via QR Code</p>
      </footer>
    </div>
  );
}

export default App;
