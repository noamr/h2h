import express from 'express'
import {serve, FileServeOptions} from '../../src/server/serve'

const port = process.env.PORT || 3000

const app = express()
app.use(serve({sourceType: 'file', source: __dirname} as FileServeOptions))
app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})