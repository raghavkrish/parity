import type { Browser } from "playwright";

export async function renderPdf(browser: Browser, printHtml: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(printHtml, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
