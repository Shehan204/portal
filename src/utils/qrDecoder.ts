import jsQR from 'jsqr';

export interface DecodedQRResult {
  data: string;
  timestamp: number;
  decodeLatencyMs: number;
  engine: 'BarcodeDetector' | 'jsQR';
  location?: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  };
}

export class QRScannerEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private barcodeDetector: any = null;
  private hasBarcodeDetector = false;
  private frameCount = 0;
  private lastFpsCalcTime = performance.now();
  private currentFps = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    // Check if BarcodeDetector is available natively in browser
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        // @ts-ignore
        this.barcodeDetector = new window.BarcodeDetector({
          formats: ['qr_code'],
        });
        this.hasBarcodeDetector = true;
      } catch (e) {
        this.hasBarcodeDetector = false;
      }
    }
  }

  /**
   * Reads video frame and attempts QR decoding
   */
  public async scanVideoFrame(
    video: HTMLVideoElement
  ): Promise<DecodedQRResult | null> {
    if (!video || video.readyState < 2) {
      return null;
    }

    const startTime = performance.now();

    // Track FPS
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsCalcTime >= 1000) {
      this.currentFps = (this.frameCount * 1000) / (now - this.lastFpsCalcTime);
      this.frameCount = 0;
      this.lastFpsCalcTime = now;
    }

    // Try high-speed Native BarcodeDetector first
    if (this.hasBarcodeDetector && this.barcodeDetector) {
      try {
        const barcodes = await this.barcodeDetector.detect(video);
        if (barcodes && barcodes.length > 0) {
          const barcode = barcodes[0];
          const decodeLatencyMs = performance.now() - startTime;
          return {
            data: barcode.rawValue,
            timestamp: Date.now(),
            decodeLatencyMs,
            engine: 'BarcodeDetector',
            location: barcode.cornerPoints
              ? {
                  topLeft: barcode.cornerPoints[0] || { x: 0, y: 0 },
                  topRight: barcode.cornerPoints[1] || { x: 0, y: 0 },
                  bottomRight: barcode.cornerPoints[2] || { x: 0, y: 0 },
                  bottomLeft: barcode.cornerPoints[3] || { x: 0, y: 0 },
                }
              : undefined,
          };
        }
      } catch {
        // Fallback to jsQR on error
      }
    }

    // Universal fallback: jsQR
    if (!this.ctx) return null;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) return null;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.ctx.drawImage(video, 0, 0, width, height);
    const imageData = this.ctx.getImageData(0, 0, width, height);

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    const decodeLatencyMs = performance.now() - startTime;

    if (code && code.data) {
      return {
        data: code.data,
        timestamp: Date.now(),
        decodeLatencyMs,
        engine: 'jsQR',
        location: {
          topLeft: code.location.topLeftCorner,
          topRight: code.location.topRightCorner,
          bottomRight: code.location.bottomRightCorner,
          bottomLeft: code.location.bottomLeftCorner,
        },
      };
    }

    return null;
  }

  public getFps(): number {
    return Math.round(this.currentFps);
  }

  public getEngineName(): string {
    return this.hasBarcodeDetector ? 'Native BarcodeDetector' : 'jsQR CPU Engine';
  }
}
