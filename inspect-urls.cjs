const https = require('https');
const http = require('http');

const urls = [
  'http://freepbr.com',
  'https://freepbr.com/c/sci-fi/',
  'https://assetstore.unity.com/packages/tools/utilities/inspector-button-pro-editor-buttons-with-parameters-151474',
  'https://www.unrealengine.com/marketplace/en-US/product/card-back-pack',
  'https://www.reddit.com/r/Unity3D/comments/1m8qfu/hearthstone_card_highlights/'
];

async function checkUrl(urlStr) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.get(urlStr, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,de;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        }
      }, (res) => {
        // Handle redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.log(`[${urlStr}] REDIRECT -> ${res.headers.location}`);
          resolve(checkUrl(new URL(res.headers.location, urlStr).href));
          return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log(`\n=== URL: ${urlStr} (Status ${res.statusCode}, Length ${data.length}) ===`);
          // Check meta tags
          const metas = data.match(/<meta\b[^>]*>/gi) || [];
          const imageMetas = metas.filter(m => /image|og:|twitter:/i.test(m));
          console.log('Image / OG / Twitter metas:');
          for (const m of imageMetas) {
            console.log('  ', m);
          }
          // Check link tags
          const links = data.match(/<link\b[^>]*>/gi) || [];
          const imgLinks = links.filter(l => /image|thumbnail|icon/i.test(l));
          console.log('Image / icon link tags:');
          for (const l of imgLinks) {
            console.log('  ', l);
          }
          // Check JSON-LD
          const jsonLd = data.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
          console.log('JSON-LD count:', jsonLd.length);
          for (const s of jsonLd) {
            if (s.includes('image')) console.log('  JSON-LD with image:', s.slice(0, 300));
          }
          resolve();
        });
      });
      req.on('error', (err) => {
        console.error(`[${urlStr}] Error:`, err.message);
        resolve();
      });
    } catch (e) {
      console.error(`[${urlStr}] Error:`, e.message);
      resolve();
    }
  });
}

(async () => {
  for (const u of urls) {
    await checkUrl(u);
  }
})();
