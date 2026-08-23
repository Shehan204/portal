import QRCode from 'qrcode';

export interface QROptions {
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  margin?: number;
  width?: number;
  color?: {
    dark?: string;
    light?: string;
  };
}

/**
 * High-speed QR Code renderer to an HTML Canvas
 */
export async function renderQRToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  options?: QROptions
): Promise<void> {
  const opts = {
    errorCorrectionLevel: options?.errorCorrectionLevel || 'L', // 'L' (7%) allows lowest density & fastest decode
    margin: options?.margin !== undefined ? options.margin : 1,
    width: options?.width || 360,
    color: {
      dark: options?.color?.dark || '#000000',
      light: options?.color?.light || '#FFFFFF',
    },
  };

  await QRCode.toCanvas(canvas, text, opts);
}

/**
 * Generate QR Data URL string
 */
export async function generateQRDataUrl(
  text: string,
  options?: QROptions
): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: options?.errorCorrectionLevel || 'L',
    margin: options?.margin !== undefined ? options.margin : 1,
    width: options?.width || 360,
    color: {
      dark: options?.color?.dark || '#000000',
      light: options?.color?.light || '#FFFFFF',
    },
  });
}
