import { protocol, net, app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function registerPetAssetProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'pet-asset',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

export function registerPetAssetHandler(): void {
  protocol.handle('pet-asset', async (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const target = pathToFileURL(join(app.getAppPath(), filePath)).toString()
    try {
      const response = await net.fetch(target)
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Origin', '*')
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    } catch (error) {
      return new Response(String(error), { status: 404 })
    }
  })
}
