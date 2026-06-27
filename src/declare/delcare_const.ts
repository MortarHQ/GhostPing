import protocols from "./protocols.json";

export const VERSION_TO_PROTOCOL_MAP = protocols;


export type VERSION = keyof typeof VERSION_TO_PROTOCOL_MAP;
export type ServerStatus = {
  previewsChat: Boolean;
  enforcesSecureChat: Boolean;
  description: Object;
  players: {
    max: Number;
    online: Number;
    sample?: { name: String; id: String }[];
  };
  version: {
    name: VERSION | String;
    protocol:
      | (typeof VERSION_TO_PROTOCOL_MAP)[keyof typeof VERSION_TO_PROTOCOL_MAP]
      | Number;
  };
  favicon: String;
  forgeData?: {
    fmlNetworkVersion: Number;
    d: String;
    chanels: {
      res: String;
      version: String;
      required: Boolean;
    }[];
    mods: [
      {
        modId: String;
        modmarker: String;
      }
    ];
    truncated: true;
  };
  modinfo?: {
    type: "FML";
    modList: {
      modid: String;
      version: String;
    };
  };
  modpackData?: {
    projectID: Number;
    name: String;
    version: String;
    isMetadata: Boolean;
  };
};
