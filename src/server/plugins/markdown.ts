import {JSDOM} from 'jsdom'
import {readFile} from 'fs-extra'
import path from 'path'
import MarkdownIt from 'markdown-it'

export default async function executeMarkdown({window}: JSDOM, basePath: string) {
    const markdowns = window.document.querySelectorAll('trans-md')
    const markd = new MarkdownIt()
    await Promise.all(Array.from(markdowns).map(async md => {
        const inline = md.firstChild ? (md.firstChild as Text).textContent : null
        if (!md.hasAttribute('src') && !inline)
            return
        const markdown = inline || await readFile(path.join(basePath, md.getAttribute('src') as string), 'utf8')
        md.outerHTML = markd.render(markdown)
    }))
}
