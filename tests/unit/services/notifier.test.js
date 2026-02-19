const notifier = require('../../../src/services/notifier');
const axios = require('axios');
const config = require('../../../src/config');
const { log } = require('../../../src/utils/logger');

jest.mock('axios');
jest.mock('../../../src/config', () => ({
    NTFY: {
        ENABLED: true,
        SERVER: 'http://ntfy.sh',
        TOPIC: 'test_topic',
    },
}));
jest.mock('../../../src/utils/logger');

describe('Notifier Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        config.NTFY.ENABLED = true;
    });

    describe('sendNotification', () => {
        it('should send notification if enabled', async () => {
            axios.post.mockResolvedValue({ status: 200 });

            const result = await notifier.sendNotification('Title', 'Message', ['tag']);

            expect(result).toBe(true);
            expect(axios.post).toHaveBeenCalledWith(
                'http://ntfy.sh',
                expect.objectContaining({
                    topic: 'test_topic',
                    title: 'Title',
                    message: 'Message',
                    tags: ['tag'],
                }),
                expect.any(Object)
            );
        });

        it('should not send notification if disabled', async () => {
            config.NTFY.ENABLED = false;

            const result = await notifier.sendNotification('Title', 'Message');

            expect(result).toBeUndefined(); // Returns undefined if disabled
            expect(axios.post).not.toHaveBeenCalled();
        });

        it('should handle errors', async () => {
            axios.post.mockRejectedValue(new Error('Network Error'));

            const result = await notifier.sendNotification('Title', 'Message');

            expect(result).toBe(false);
            expect(log.error).toHaveBeenCalled();
        });
    });

    describe('notifyMovieAdded', () => {
        it('should call sendNotification with correct format', async () => {
            const sendSpy = jest.spyOn(notifier, 'sendNotification').mockResolvedValue(true);

            await notifier.notifyMovieAdded('Movie', '2024');

            expect(sendSpy).toHaveBeenCalledWith(
                '🎬 New Movie Added',
                'Movie (2024)',
                expect.arrayContaining(['movie_camera', 'tamilmv'])
            );
        });
    });

    describe('notifyError', () => {
        it('should call sendNotification with correct format', async () => {
            const sendSpy = jest.spyOn(notifier, 'sendNotification').mockResolvedValue(true);

            await notifier.notifyError('Op', 'Err');

            expect(sendSpy).toHaveBeenCalledWith(
                '🚨 Automation Error',
                expect.stringContaining('Op'),
                expect.arrayContaining(['rotating_light'])
            );
        });
    });
});
