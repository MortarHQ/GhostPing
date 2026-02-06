export type DescriptionPart =
  | string
  | {
      text?: string;
      color?: string;
      bold?: boolean;
      italic?: boolean;
      underlined?: boolean;
    };

export type ServerStatus = {
  version?: {
    name?: string;
    protocol?: number;
  };
  favicon?: string;
  description?: DescriptionPart[] | { text?: string } | string;
  players?: {
    online?: number;
    max?: number;
    sample?: Array<{ name: string; id?: string }>;
  };
  [key: string]: unknown;
};
