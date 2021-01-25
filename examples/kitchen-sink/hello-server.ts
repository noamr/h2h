import {helloLodash} from "./hello-lodash.ts"
import {hello} from "./hello-world.ts"

window.document.querySelector('#server-output').innerHTML = `${hello()} ${helloLodash()}`
