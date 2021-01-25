import fs from 'fs-extra'
import path from 'path'
import express from 'express'
import {buildIfNeeded} from './bundle-rewriter'
import {executeHTML} from './execute'

export default function serve(assetDir: string) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const userAgent = req.header('user-agent') || 'Chrome/80'
        const safariVersion = /\/(\d+).\d+.\d+ Safari\//.exec(userAgent)
        const chromeVersion = / Chrome\/(\d+)/.exec(userAgent)
        const firefoxVersion = / Firefox\/(\d+)/.exec(userAgent)
        const browser = safariVersion ? `safari${safariVersion[1]}` : chromeVersion ? `chrome${chromeVersion[1]}` : firefoxVersion ? `firefox${firefoxVersion[1]}` : 'chrome80'
        const dir = await buildIfNeeded({rootDir: path.normalize(assetDir), browser})
        if ((req.headers['accept'] || '').includes('text/html')) {
            const html = await fs.readFile(path.join(dir, req.path || 'index.html'), 'utf8')
            if (html) {
                const rewritten = await executeHTML(html, dir)
                res.setHeader('Content-type', 'text/html')
                res.send(rewritten.html)
                return
            }
        }
        express.static(dir)(req, res, next)
    }
}