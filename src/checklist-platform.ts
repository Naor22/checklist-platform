import http, { IncomingMessage, Server, ServerResponse } from "http";
import {
  API,
  APIEvent,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
} from "homebridge";
import * as fs from "fs";
import * as path from "path";

const PLUGIN_NAME = "homebridge-checklist-plugin";
const PLATFORM_NAME = "ChecklistPlatform";

let hap: HAP;
let Accessory: typeof PlatformAccessory;

export = (api: API) => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLATFORM_NAME, ChecklistPlatform);
};

class ChecklistPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;

  private requestServer?: Server;

  private readonly accessories: PlatformAccessory[] = [];
  private checklist: { name: string; checked: boolean }[] = [];
  private readonly checklistFile: string;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;

    // Define the path for the checklist storage
    this.checklistFile = path.join(this.api.user.storagePath(), "checklist.json");
    this.loadChecklist();

    log.info("Checklist platform finished initializing!");

    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      log.info("Checklist platform 'didFinishLaunching'");

      // Add accessories based on the checklist
      this.checklist.forEach((item, index) => {
        this.addAccessory(item.name, index);
      });

      // Start the HTTP service for external interactions
      this.createHttpService();
    });
  }

  loadChecklist() {
    if (fs.existsSync(this.checklistFile)) {
      this.checklist = JSON.parse(fs.readFileSync(this.checklistFile, "utf-8"));
    } else {
      this.checklist = [];
    }
  }

  saveChecklist() {
    fs.writeFileSync(this.checklistFile, JSON.stringify(this.checklist, null, 2));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info("Configuring accessory %s", accessory.displayName);

    const index = this.checklist.findIndex((item) => item.name === accessory.displayName);
    if (index === -1) {
      this.log.warn("Accessory not found in checklist, skipping configuration.");
      return;
    }

    accessory
      .getService(hap.Service.Switch)!
      .getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.log.info("Setting state of %s to %s", accessory.displayName, value);
        this.checklist[index].checked = value as boolean;
        this.saveChecklist();
        callback();
      });

    this.accessories.push(accessory);
  }

  addAccessory(name: string, index: number) {
    const uuid = hap.uuid.generate(name);
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (!existingAccessory) {
      this.log.info("Adding new accessory with name %s", name);

      const accessory = new Accessory(name, uuid);
      const service = accessory.addService(hap.Service.Switch, name);

      service
        .getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
          this.log.info("Setting state of %s to %s", name, value);
          this.checklist[index].checked = value as boolean;
          this.saveChecklist();
          callback();
        });

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  createHttpService() {
    this.requestServer = http.createServer((request: IncomingMessage, response: ServerResponse) => {
      if (request.method === "GET" && request.url === "/checklist") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(this.checklist));
      } else if (request.method === "POST" && request.url === "/checklist") {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk.toString();
        });
        request.on("end", () => {
          try {
            const updatedChecklist = JSON.parse(body);
            this.checklist = updatedChecklist;
            this.saveChecklist();
            response.writeHead(200);
            response.end("Checklist updated.");
          } catch (error) {
            response.writeHead(400);
            response.end("Invalid JSON.");
          }
        });
      } else {
        response.writeHead(404);
        response.end("Not found.");
      }
    });

    this.requestServer.listen(3000, () => {
      this.log.info("HTTP server listening on port 3000.");
    });
  }
}
