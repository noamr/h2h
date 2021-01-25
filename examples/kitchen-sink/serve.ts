import express from 'express'
import serve from '../../src/server/serve'

const port = process.env.PORT || 3000

const app = express()
app.use(serve(__dirname))
app.listen(port, () => {
    console.log(`Listening on port ${port}`)
})