import { protocol, net, app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function registerPetAssetProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'pet-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

export function registerPetAssetHandler(): void {
  protocol.handle('pet-asset', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    return net.fetch(pathToFileURL(join(app.getAppPath(), filePath)).toString())
  })
}
