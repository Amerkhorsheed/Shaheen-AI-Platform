'use strict';

const { Router } = require('express');

const authService = require('../../services/authService');
const { asyncHandler, authenticate, validate, loginLimiter, writeLimiter } = require('../middleware');
const { loginSchema, changePasswordSchema } = require('../validators');

const router = Router();

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.login({
      username: req.body.username.toLowerCase(),
      password: req.body.password,
      ipAddress: req.ip
    });
    res.json(result);
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await authService.getProfile(req.user.id));
  })
);

router.post(
  '/change-password',
  authenticate,
  writeLimiter,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.changePassword({
      userId: req.user.id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      ipAddress: req.ip
    });
    res.json({ message: 'تم تغيير كلمة المرور بنجاح', ...result });
  })
);

module.exports = router;
