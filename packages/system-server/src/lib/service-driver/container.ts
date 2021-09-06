import * as Docker from 'dockerode'
import { ApplicationStruct, getApplicationDbUri } from '../../api/application'
import Config from '../../config'
import { logger } from '../logger'


export class DockerContainerServiceDriver {
  docker: Docker

  constructor(options?: Docker.DockerOptions) {
    this.docker = new Docker(options)
  }

  /**
   * Create application service
   * @param app 
   * @returns 
   */
  async createService(app: ApplicationStruct) {
    const uri = getApplicationDbUri(app)

    const container = await this.docker.createContainer({
      Image: Config.APP_SERVICE_IMAGE,
      Cmd: ['node', './dist/start.js'],
      name: `app_${app.appid}`,
      Env: [
        `DB=${app.config.db_name}`,
        `DB_URI=${uri}`,
        `LOG_LEVEL=debug`,
        `ENABLE_CLOUD_FUNCTION_LOG=always`,
        `SERVER_SECRET_SALT=${app.config.server_secret_salt}`
      ],
      ExposedPorts: {
        "8000/tcp": {}
      },
      HostConfig: {
      }
    })

    logger.debug(`create container ${container.id} of app ${app.appid}`)

    // add the the app network
    const net = await this.getSharedNetwork()
    await net.connect({ Container: container.id })

    return container
  }

  /**
   * Start application service
   * @param app 
   * @returns the container id
   */
  async startService(app: ApplicationStruct) {
    let container = this.getContainer(app)
    const info = await this.info(app)
    if (!info) {
      container = await this.createService(app)
    }

    if (info?.State?.Running || info?.State?.Restarting) {
      return container.id
    }

    await container.start()
    logger.debug(`start container ${container.id} of app ${app.appid}`)

    return container.id
  }

  /**
   * Remove application service
   * @param app 
   */
  async removeService(app: ApplicationStruct) {
    const info = await this.info(app)
    if (!info) {
      return
    }

    const container = this.getContainer(app)
    if (info.State.Running) {
      await container.stop()
    }

    if (info.State.Restarting) {
      await container.stop()
    }

    await container.remove()
    logger.debug(`remove container ${container.id} of app ${app.appid}`)

    return container.id
  }

  /**
   * Get container info
   * @param container 
   * @returns return null if container not exists
   */
  async info(app: ApplicationStruct): Promise<Docker.ContainerInspectInfo> {
    try {
      const container = this.getContainer(app)
      const info = await container.inspect()
      return info
    } catch (error) {
      if (error.reason === 'no such container') {
        return null
      }
      throw error
    }
  }

  getContainer(app: ApplicationStruct) {
    return this.docker.getContainer(`app_${app.appid}`)
  }

  /**
   * Get or create the shared network
   * @returns 
   */
  async getSharedNetwork() {
    const name = Config.SHARED_NETWORK
    let net = this.docker.getNetwork(name)
    const info = await net.inspect()
    if (!info) {
      net = await this.docker.createNetwork({
        Name: name,
        Driver: 'bridge'
      })
    }

    return net
  }
}