customElements.define('trans-inc', class TransInclude extends HTMLElement {
    constructor() {
        super()
    }

    get observedAttributes() { return ['src'] }

    async attributesChangedCallback() {
        this.render()
    }

    async render() {
        if (!this.hasAttribute('src'))
            return
        const html = await (await fetch(this.getAttribute('src') as string)).text()
        this.outerHTML = html
    }

    connectedCallback() {
        this.render()
    }
})