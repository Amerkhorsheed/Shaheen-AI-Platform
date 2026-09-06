'use strict';

/**
 * API surface.
 *
 * One place that shows every route the platform exposes and where it is
 * implemented, instead of registrations scattered across half a dozen modules.
 */

const { Router } = require('express');

const { ping } = require('../../db/pool');
const migrate = require('../../db/migrate');
const { asyncHandler } = require('../middleware');

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const categoryRoutes = require('./categoryRoutes');
const chatRoutes = require('./chatRoutes');
const templateRoutes = require('./templateRoutes');
const settingsRoutes = require('./settingsRoutes');
const promptRoutes = require('./promptRoutes');
const modelRoutes = require('./modelRoutes');
const uploadRoutes = require('./uploadRoutes');
const exportRoutes = require('./exportRoutes');

const router = Router();

/**
 * Liveness and readiness. Unauthenticated on purpose — orchestrators need it —
 * so it reports only whether the process can serve, never configuration.
 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const healthy = await ping();
    const [latest] = await migrate.status().catch(() => []);

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      database: healthy ? 'up' : 'down',
      schemaVersion: latest?.version ?? null
    });
  })
);

router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);
router.use('/chats', chatRoutes);
router.use('/templates', templateRoutes);
router.use('/settings', settingsRoutes);
router.use('/prompts', promptRoutes);
router.use('/upload', uploadRoutes);
router.use('/export', exportRoutes);

// These declare their own full paths (`/users`, `/audit-logs`, `/llm/...`).
router.use('/', userRoutes);
router.use('/', modelRoutes);

module.exports = router;
