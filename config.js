/**
 * Free Upload Manager — Konfiguration
 * =====================================
 * WORKER_URL pekar nu på Render-proxyn för uppladdning.
 * Cloudflare Worker används bara för download-sidan (/page/).
 */
const FUM_CONFIG = {
  WORKER_URL: 'http://82.70.60.250:3000',
};
