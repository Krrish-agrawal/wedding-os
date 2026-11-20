import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { REPORT_CHANNELS } from '@ave/shared';
import { leadDetail, listLeads } from './leads.js';
import { sendReport } from './reports.js';
import { deskFor } from './runtime.js';

const ResendBody = z
  .object({ channels: z.array(z.enum(REPORT_CHANNELS)).min(1).optional() })
  .nullish()
  .transform((b) => ({ channels: b?.channels ?? [...REPORT_CHANNELS] }));

/** Lead Desk API: leads with scores, lead detail, recap resend, and the Outbox. */
export const deskRoutes: FastifyPluginAsync = async (app) => {
  const desk = () => deskFor(app.ctx);

  app.get('/api/leads', async () => ({ leads: listLeads(desk(), Date.now()) }));

  app.get<{ Params: { id: string } }>('/api/leads/:id', async (req, reply) => {
    const lead = leadDetail(desk(), req.params.id, Date.now());
    if (!lead) return reply.code(404).send({ error: 'Lead not found' });
    return { lead };
  });

  app.post<{ Params: { id: string } }>('/api/leads/:id/report', async (req, reply) => {
    const parsed = ResendBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Choose email, WhatsApp or both.' });
    if (!desk().getState(req.params.id)) return reply.code(404).send({ error: 'Lead not found' });
    const deliveries = await sendReport(app.ctx, req.params.id, parsed.data.channels);
    return { deliveries };
  });

  app.get('/api/outbox', async () => ({ items: desk().leads.listOutbox() }));
};
