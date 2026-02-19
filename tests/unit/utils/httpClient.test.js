const {
    createHttpClient,
    createApiClient,
    createScraperClient,
} = require('../../../src/utils/httpClient');

describe('HttpClient', () => {
    describe('createHttpClient', () => {
        it('should create http client with default config', () => {
            const client = createHttpClient();

            expect(client.defaults.timeout).toBeDefined();
            expect(client.defaults.headers['User-Agent']).toContain('Mozilla');
        });

        it('should merge custom config with defaults', () => {
            const customConfig = {
                timeout: 5000,
                headers: {
                    'X-Custom-Header': 'test',
                },
            };

            const client = createHttpClient(customConfig);

            expect(client.defaults.timeout).toBe(5000);
            expect(client.defaults.headers['X-Custom-Header']).toBe('test');
            expect(client.defaults.headers['User-Agent']).toContain('Mozilla');
        });

        it('should handle empty custom config', () => {
            const client = createHttpClient({});

            expect(client.defaults.headers['User-Agent']).toBeDefined();
        });
    });

    describe('createApiClient', () => {
        it('should create API client with JSON headers', () => {
            const client = createApiClient('http://api.example.com');

            expect(client.defaults.baseURL).toBe('http://api.example.com');
            expect(client.defaults.headers['Content-Type']).toBe('application/json');
            expect(client.defaults.headers['Accept']).toBe('application/json');
        });

        it('should merge custom config for API client', () => {
            const customConfig = {
                timeout: 3000,
            };

            const client = createApiClient('http://api.example.com', customConfig);

            expect(client.defaults.timeout).toBe(3000);
            expect(client.defaults.headers['Content-Type']).toBe('application/json');
        });
    });

    describe('createScraperClient', () => {
        it('should create scraper client with custom timeout', () => {
            const client = createScraperClient();

            expect(client.defaults.timeout).toBeDefined();
            expect(client.defaults.headers['User-Agent']).toContain('Mozilla');
        });

        it('should merge custom config for scraper', () => {
            const customConfig = {
                maxRedirects: 10,
            };

            const client = createScraperClient(customConfig);

            expect(client.defaults.maxRedirects).toBe(10);
        });
    });
});
