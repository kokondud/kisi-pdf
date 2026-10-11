// Membuat PDF detail produk (reksa dana & obligasi) dari halaman Fund Insight / Bond Insight, sama seperti tombol Export PDF.
// Dijalankan terjadwal oleh GitHub Actions (.github/workflows/pdf.yml). Hasil: out/fund-<kode>.pdf, out/bond-<kode>.pdf, out/keep.txt
import { chromium } from 'playwright';
import fs from 'fs';

const FUND = (process.env.FUND_URL || 'https://kisi-fund-insight.kho-xaverius.workers.dev').replace(/\/+$/, '');
const BOND = (process.env.BOND_URL || 'https://kisi-bond-insight.kho-xaverius.workers.dev').replace(/\/+$/, '');
fs.mkdirSync('out', { recursive: true });

const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status); return r.json(); };
const browser = await chromium.launch();
const keep = [], result = {};

/** kind: awalan nama file. ids: kode produk. open: halaman yang punya fungsi pdf(). ready: tanda data halaman sudah termuat. */
async function make(kind, ids, open, ready) {
  let ok = 0; const fail = [];
  const page = await browser.newPage();
  try {
    await page.goto(open, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(ready, null, { timeout: 60000 });
    await page.evaluate(() => { window.print = () => { }; });          // pdf() halaman memanggil window.print(); di sini cukup susunan halamannya
    for (const id of ids) {
      try {
        const pages = await page.evaluate(async (id) => { document.getElementById('pdfout').innerHTML = ''; await pdf([id]); await document.fonts.ready; return document.querySelectorAll('#pdfout .pg-a4').length; }, id);
        if (!pages) { fail.push(id + ' (belum ada data)'); continue; }
        await page.pdf({ path: `out/${kind}-${id}.pdf`, preferCSSPageSize: true, printBackground: true });
        ok++;
      } catch (e) { fail.push(id + ' (' + String(e.message || e).split('\n')[0] + ')'); }
    }
  } finally { await page.close(); }
  result[kind] = { total: ids.length, ok, fail };
  console.log(`${kind}: ${ok} dari ${ids.length} PDF dibuat` + (fail.length ? `\n  dilewati: ${fail.join(', ')}` : ''));
}

let listed = 0;
try {
  const ids = (await getJson(FUND + '/api/funds')).funds.map((f) => String(f.pid)).filter((p) => /^\d+$/.test(p));
  ids.forEach((id) => keep.push(`fund-${id}.pdf`)); listed++;
  await make('fund', ids, `${FUND}/p/${ids[0]}`, () => typeof funds !== 'undefined' && funds.length > 0 && typeof pdf === 'function');
} catch (e) { console.log('fund: GAGAL - ' + (e.message || e)); result.fund = { ok: 0 }; }
try {
  const ids = (await getJson(BOND + '/data/bonds.json')).bonds.map((b) => String(b.code)).filter((c) => /^[A-Za-z0-9_-]{2,40}$/.test(c));
  ids.forEach((id) => keep.push(`bond-${id}.pdf`)); listed++;
  await make('bond', ids, `${BOND}/share`, () => typeof bonds !== 'undefined' && bonds.length > 0 && typeof pdf === 'function');
} catch (e) { console.log('bond: GAGAL - ' + (e.message || e)); result.bond = { ok: 0 }; }
await browser.close();

// keep.txt = daftar produk yang masih ada; PDF di luar daftar ini dihapus dari rilis. Hanya ditulis kalau KEDUA daftar terbaca,
// supaya gangguan sesaat di salah satu situs tidak menghapus PDF yang masih dipakai link di email.
if (listed === 2) fs.writeFileSync('out/keep.txt', keep.join('\n') + '\n');
fs.writeFileSync('status.txt', `${new Date().toISOString()} fund ${result.fund.ok} bond ${result.bond.ok}\n`);
if (!result.fund.ok || !result.bond.ok) { console.log('Ada bagian yang tidak menghasilkan PDF sama sekali. PDF lama tetap dipakai.'); process.exit(1); }
