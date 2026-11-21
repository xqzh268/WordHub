import type { CommandPayloads, CommandResults } from "@wordhub/contracts";

export type ProviderList = CommandResults["settings.providers"];
export type ProviderItem = ProviderList["providers"][number];
export type RemoteModel =
  CommandResults["settings.fetchModels"]["models"][number];
export type CustomInput = NonNullable<
  CommandPayloads["settings.addProvider"]["custom"]
>;
