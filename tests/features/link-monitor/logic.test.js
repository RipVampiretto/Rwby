/**
 * Tests for link-monitor/logic.js
 */

const { extractLinks, getDomain, checkIntel, scanMessage, init } = require('../../../src/features/link-monitor/logic');

describe('Link Monitor Logic', () => {
    describe('extractLinks()', () => {
        it('should extract HTTP URLs', () => {
            const text = 'Check out http://example.com for more info';
            const links = extractLinks(text);
            expect(links).toContain('http://example.com');
        });

        it('should extract HTTPS URLs', () => {
            const text = 'Visit https://secure-site.com/page';
            const links = extractLinks(text);
            expect(links).toContain('https://secure-site.com/page');
        });

        it('should extract multiple URLs', () => {
            const text = 'Site 1: https://first.com and site 2: http://second.org';
            const links = extractLinks(text);
            expect(links).toHaveLength(2);
            expect(links).toContain('https://first.com');
            expect(links).toContain('http://second.org');
        });

        it('should return empty array for text without URLs', () => {
            const text = 'No links here at all';
            const links = extractLinks(text);
            expect(links).toEqual([]);
        });

        it('should extract URLs with paths and query strings', () => {
            const text = 'Full URL: https://example.com/path/to/page?param=value&other=123';
            const links = extractLinks(text);
            expect(links).toHaveLength(1);
            expect(links[0]).toContain('example.com/path/to/page');
        });

        it('should handle URLs with ports', () => {
            const text = 'Server at http://localhost:3000/api';
            const links = extractLinks(text);
            expect(links).toContain('http://localhost:3000/api');
        });
    });

    describe('getDomain()', () => {
        it('should extract domain from URL', () => {
            expect(getDomain('https://example.com/path')).toBe('example.com');
            expect(getDomain('http://test.org')).toBe('test.org');
        });

        it('should remove www prefix', () => {
            expect(getDomain('https://www.example.com')).toBe('example.com');
            expect(getDomain('http://www.test.org/page')).toBe('test.org');
        });

        it('should handle subdomains', () => {
            expect(getDomain('https://sub.example.com')).toBe('sub.example.com');
            expect(getDomain('https://api.v2.test.org')).toBe('api.v2.test.org');
        });

        it('should return null for invalid URLs', () => {
            expect(getDomain('not-a-url')).toBeNull();
            expect(getDomain('')).toBeNull();
        });

        it('should handle URLs with ports', () => {
            expect(getDomain('https://example.com:8080/path')).toBe('example.com');
        });
    });

    describe('checkIntel()', () => {
        let mockDb;

        beforeEach(() => {
            mockDb = {
                queryOne: jest.fn()
            };
            init(mockDb);
        });

        it('should return "whitelist" for whitelisted domains', async () => {
            mockDb.queryOne.mockResolvedValue({ type: 'whitelist_domain' });
            const result = await checkIntel('trusted.com');
            expect(result).toBe('whitelist');
        });

        it('should return "blacklist" for blacklisted domains', async () => {
            mockDb.queryOne.mockResolvedValue({ type: 'blacklist_domain' });
            const result = await checkIntel('malicious.com');
            expect(result).toBe('blacklist');
        });

        it('should return "unknown" for unrecognized domains', async () => {
            mockDb.queryOne.mockResolvedValue(null);
            const result = await checkIntel('unknown.com');
            expect(result).toBe('unknown');
        });

        it('should query intel_data table with domain', async () => {
            mockDb.queryOne.mockResolvedValue(null);
            await checkIntel('test.com');
            expect(mockDb.queryOne).toHaveBeenCalledWith(
                expect.stringContaining('intel_data'),
                ['test.com']
            );
        });
    });

    describe('scanMessage()', () => {
        let mockDb;
        let mockCtx;
        let mockConfig;

        beforeEach(() => {
            mockDb = {
                queryOne: jest.fn()
            };
            init(mockDb);

            mockCtx = {
                message: { text: '' },
                chat: { id: -1001234567890 }
            };
            mockConfig = {
                link_sync_global: false
            };
        });

        it('should return null for messages without links', async () => {
            mockCtx.message.text = 'No links here';
            const result = await scanMessage(mockCtx, mockConfig);
            expect(result).toBeNull();
        });

        it('should return unknown type for new links when sync disabled', async () => {
            mockCtx.message.text = 'Check https://newsite.com';
            mockConfig.link_sync_global = false;

            const result = await scanMessage(mockCtx, mockConfig);
            expect(result).not.toBeNull();
            expect(result.type).toBe('unknown');
            expect(result.domain).toBe('newsite.com');
        });

        it('should check intel when sync enabled', async () => {
            mockCtx.message.text = 'Visit https://somesite.com';
            mockConfig.link_sync_global = true;
            mockDb.queryOne.mockResolvedValue(null);

            await scanMessage(mockCtx, mockConfig);
            expect(mockDb.queryOne).toHaveBeenCalled();
        });

        it('should skip whitelisted domains', async () => {
            mockCtx.message.text = 'Safe link: https://trusted.com and https://unsafe.com';
            mockConfig.link_sync_global = true;

            // First call returns whitelist, second returns unknown
            mockDb.queryOne
                .mockResolvedValueOnce({ type: 'whitelist_domain' })
                .mockResolvedValueOnce(null);

            const result = await scanMessage(mockCtx, mockConfig);
            expect(result.domain).toBe('unsafe.com'); // Should skip trusted.com
        });

        it('should detect blacklisted domains', async () => {
            mockCtx.message.text = 'Bad link: https://malicious.com';
            mockConfig.link_sync_global = true;
            mockDb.queryOne.mockResolvedValue({ type: 'blacklist_domain' });

            const result = await scanMessage(mockCtx, mockConfig);
            expect(result.type).toBe('blacklist');
            expect(result.domain).toBe('malicious.com');
        });

        it('should include original link in result', async () => {
            mockCtx.message.text = 'Link: https://example.com/some/path?q=1';
            mockConfig.link_sync_global = false;

            const result = await scanMessage(mockCtx, mockConfig);
            expect(result.link).toContain('https://example.com/some/path');
        });
    });
});
