const http = require('http');
const url = require('url');
const puppeteer = require('puppeteer-core');
const path = require('path');

const PORT = 3333;
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

class SearchBridge {
    constructor() {
        this.browser = null;
    }

    async ensureBrowser() {
        if (this.browser) return;

        console.log('[Bridge] Launching Edge (Headless)...');
        try {
            this.browser = await puppeteer.launch({
                executablePath: EDGE_PATH,
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--window-size=1280,800'
                ]
            });
            console.log('[Bridge] Browser launched!');

            this.browser.on('disconnected', () => {
                console.log('[Bridge] Browser disconnected.');
                this.browser = null;
            });

        } catch (e) {
            console.error('[Bridge] Failed to launch browser:', e);
            throw e;
        }
    }

    async search(query) {
        await this.ensureBrowser();
        const page = await this.browser.newPage();
        let results = [];

        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0');

            console.log(`[Bridge] Navigating to Bing: ${query}`);
            const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;

            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

            try {
                await page.waitForSelector('#b_results > li.b_algo', { timeout: 5000 });
            } catch {
                console.log('[Bridge] Timeout waiting for selectors.');
            }

            // Extract initial results
            results = await page.evaluate(() => {
                const items = document.querySelectorAll('#b_results > li.b_algo');
                const data = [];
                items.forEach(item => {
                    const titleEl = item.querySelector('h2 > a');
                    const snippetEl = item.querySelector('.b_caption p') || item.querySelector('.b_snippet');
                    if (titleEl && snippetEl) {
                        data.push({
                            title: titleEl.innerText.trim(),
                            link: titleEl.href,
                            snippet: snippetEl.innerText.trim()
                        });
                    }
                });
                return data;
            });

            console.log(`[Bridge] Found ${results.length} results.`);

            // DEEP SEARCH: Visit the first result
            if (results.length > 0) {
                const topResult = results[0];
                console.log(`[Bridge] Deep Search on: ${topResult.link}`);

                try {
                    await page.goto(topResult.link, { waitUntil: 'domcontentloaded', timeout: 15000 });

                    // Update link with the final resolved URL (removes bing.com/ck/...)
                    topResult.link = page.url();

                    // Simple text extraction
                    const content = await page.evaluate(() => {
                        // Remove scripts, styles, navs to clean up
                        const scripts = document.querySelectorAll('script, style, nav, footer, header, aside');
                        scripts.forEach(s => s.remove());

                        // Get body text
                        let text = document.body.innerText || '';
                        return text.replace(/\s+/g, ' ').trim().slice(0, 4000); // Limit to 4000 chars
                    });

                    if (content.length > 100) {
                        console.log(`[Bridge] Extracted ${content.length} chars of content.`);
                        topResult.full_content = content;
                    } else {
                        console.log('[Bridge] Content extraction too short/failed.');
                    }
                } catch (e) {
                    console.error(`[Bridge] Deep Search failed: ${e.message}`);
                }
            }

            return results;

        } catch (e) {
            console.error(`[Bridge] Error during search: ${e.message}`);
            return results;
        } finally {
            await page.close();
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

const bridge = new SearchBridge();
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/search' && req.method === 'GET') {
        const query = parsedUrl.query.q;
        if (!query) {
            res.writeHead(400);
            return res.end('Missing query');
        }
        try {
            const results = await bridge.search(query);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
        } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`[Bridge] HTTP Server running on port ${PORT}`);
    console.log(`[Bridge] Deep Search Enabled (Puppeteer)`);
});

process.on('SIGINT', async () => {
    await bridge.close();
    process.exit(0);
});
