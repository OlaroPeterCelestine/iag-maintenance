import qrcode from "qrcode-generator";

/**
 * The address a machine's QR label opens: its page in this app. Scanned on
 * the floor, it shows the machine's open work and history and offers
 * "Report a fault" with the machine already filled in.
 */
export function machineUrl(origin: string, tag: string): string {
  return `${origin.replace(/\/$/, "")}/machines/${encodeURIComponent(tag)}`;
}

/**
 * An SVG QR code for `text`. Error correction M (15%) survives a scuffed
 * label on a machine better than L, and the URLs here are short enough that
 * the code stays small.
 */
export function qrSvg(text: string, opts: { cellSize?: number; margin?: number } = {}): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: opts.cellSize ?? 4, margin: opts.margin ?? 2, scalable: true });
}
