import fs from 'fs-extra'
import path from 'path'
import express from 'express'
import {buildIfNeeded} from './rewrite'
import {executeHTML} from './execute'

function browserFromRequest(req: express.Request, defaultBrowser = 'chrome80') {
    const userAgent = req.header('user-agent') || ''
    const safariVersion = /\/(\d+).\d+.\d+ Safari\//.exec(userAgent)
    const chromeVersion = / Chrome\/(\d+)/.exec(userAgent)
    const firefoxVersion = / Firefox\/(\d+)/.exec(userAgent)
    return safariVersion ? `safari${safariVersion[1]}` :
            chromeVersion ? `chrome${chromeVersion[1]}` :
            firefoxVersion ? `firefox${firefoxVersion[1]}` :
            defaultBrowser
}

export default function serve(assetDir: string) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const dir = await buildIfNeeded({rootDir: path.normalize(assetDir), browser: browserFromRequest(req)})
        if ((req.headers['accept'] || '').includes('text/html')) {
            const html = await fs.readFile(path.join(dir, req.path || 'index.html'), 'utf8')
            if (html) {
                const rewritten = await executeHTML(html, dir)
                res.setHeader('Content-type', 'text/html')
                res.send((await executeHTML(html, dir)).html)
                return
            }
        }
        express.static(dir)(req, res, next)
    }
}