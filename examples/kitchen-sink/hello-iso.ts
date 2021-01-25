import {helloLodash} from "./hello-lodash.ts"
import {hello} from "./hello-world.ts"

window.document.querySelector('#iso-output').innerText = `${hello()} ${helloLodash()}`
