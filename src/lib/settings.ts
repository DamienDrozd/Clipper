import { prisma } from "@/lib/prisma";

export type ChannelSettingsValues = {
  channelName: string;
  channelDescription: string;
  tone: string;
  fixedHashtags: string;
  appendSourceLink: boolean;
};

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettingsValues = {
  channelName: "",
  channelDescription: "",
  tone: "",
  fixedHashtags: "",
  appendSourceLink: true,
};

/** Réglages de la chaîne de l'utilisateur (valeurs par défaut s'ils n'ont jamais été enregistrés). */
export async function getChannelSettings(userId: string): Promise<ChannelSettingsValues> {
  const row = await prisma.channelSettings.findUnique({ where: { userId } });
  if (!row) return DEFAULT_CHANNEL_SETTINGS;
  const { channelName, channelDescription, tone, fixedHashtags, appendSourceLink } = row;
  return { channelName, channelDescription, tone, fixedHashtags, appendSourceLink };
}
