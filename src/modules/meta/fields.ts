import {
  BREAKDOWN_CORE_FIELDS,
  BREAKDOWN_REACH_FIELDS,
  CLICK_EXTENDED_FIELDS,
  CORE_FIELDS,
  ENGAGEMENT_FIELDS,
  QUALITY_FIELDS,
  VIDEO_EXTENDED_FIELDS,
  type FieldGroupName,
} from "./constants";

export function joinFields(fields: readonly string[]): string {
  return fields.join(",");
}

export function coreInsightsFields(): string {
  return joinFields(CORE_FIELDS);
}

export function fieldGroup(name: FieldGroupName): readonly string[] {
  switch (name) {
    case "core":
      return CORE_FIELDS;
    case "video":
      return VIDEO_EXTENDED_FIELDS;
    case "quality":
      return QUALITY_FIELDS;
    case "clicks":
      return CLICK_EXTENDED_FIELDS;
    case "engagement":
      return ENGAGEMENT_FIELDS;
  }
}

export function extendedFieldGroups(): Exclude<FieldGroupName, "core">[] {
  return ["video", "quality", "clicks", "engagement"];
}

export function breakdownFields(includeReach: boolean): string {
  return joinFields(includeReach ? [...BREAKDOWN_CORE_FIELDS, ...BREAKDOWN_REACH_FIELDS] : BREAKDOWN_CORE_FIELDS);
}
