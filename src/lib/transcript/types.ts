import { z } from "zod";

/** Un segment de transcription, temps en secondes. */
export const segmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

export const segmentsSchema = z.array(segmentSchema);

export type Segment = z.infer<typeof segmentSchema>;
