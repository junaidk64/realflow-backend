import { Request, Response, NextFunction } from 'express'
import { config } from '../config'

export const n8nAuth = (req: Request, res: Response, next: NextFunction): void => {
  const secret = req.headers['x-n8n-secret']
  if (!config.n8n.callbackSecret || secret !== config.n8n.callbackSecret) {
    res.status(401).json({ success: false, message: 'Unauthorized' })
    return
  }
  next()
}

export default n8nAuth
