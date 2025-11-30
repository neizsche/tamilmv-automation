import axios from 'axios';
import { NTFY } from '../config/index.js';
import logger from '../utils/logger.js';
const { log } = logger;

class Notifier {
  async sendNotification(title, message, tags = []) {
    if (!NTFY.ENABLED) return;

    try {
      const payload = {
        topic: NTFY.TOPIC,
        title: title,
        message: message,
        tags: tags,
      };

      await post(NTFY.SERVER, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      log.success(`Notification sent: ${title}`);
    } catch (error) {
      log.error('Failed to send notification', error.message);
    }
  }

  async notifyMovieAdded(movieTitle, movieYear) {
    const title = '🎬 New Movie Added';
    const message = `${movieTitle} (${movieYear})`;
    const tags = ['movie_camera', 'tamilmv'];

    await this.sendNotification(title, message, tags);
  }

  async notifyError(operation, error) {
    const title = '🚨 Automation Error';
    const message = `Operation: ${operation}\nError: ${error}`;
    const tags = ['rotating_light'];

    await this.sendNotification(title, message, tags);
  }
}

export default new Notifier();
