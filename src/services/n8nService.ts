import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import logger from '../utils/logger';

const n8nClient: AxiosInstance = axios.create({
  baseURL: `${config.n8n.baseUrl}/api/v1`,
  headers: {
    'X-N8N-API-KEY': config.n8n.apiKey,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  nodes: unknown[];
  connections: unknown;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: 'success' | 'error' | 'running' | 'waiting';
  startedAt: string;
  stoppedAt: string;
}

export const createWorkflow = async (workflowJson: Record<string, unknown>): Promise<N8nWorkflow> => {
  try {
    const response = await n8nClient.post('/workflows', workflowJson);
    return response.data;
  } catch (error) {
    logger.error('Failed to create n8n workflow:', error);
    throw error;
  }
};

export const activateWorkflow = async (workflowId: string): Promise<N8nWorkflow> => {
  try {
    const response = await n8nClient.patch(`/workflows/${workflowId}/activate`);
    return response.data;
  } catch (error) {
    logger.error(`Failed to activate workflow ${workflowId}:`, error);
    throw error;
  }
};

export const deactivateWorkflow = async (workflowId: string): Promise<N8nWorkflow> => {
  try {
    const response = await n8nClient.patch(`/workflows/${workflowId}/deactivate`);
    return response.data;
  } catch (error) {
    logger.error(`Failed to deactivate workflow ${workflowId}:`, error);
    throw error;
  }
};

export const deleteWorkflow = async (workflowId: string): Promise<void> => {
  try {
    await n8nClient.delete(`/workflows/${workflowId}`);
  } catch (error) {
    logger.error(`Failed to delete workflow ${workflowId}:`, error);
    throw error;
  }
};

export const getWorkflow = async (workflowId: string): Promise<N8nWorkflow> => {
  const response = await n8nClient.get(`/workflows/${workflowId}`);
  return response.data;
};

export const listWorkflows = async (): Promise<N8nWorkflow[]> => {
  const response = await n8nClient.get('/workflows');
  return response.data.data || [];
};

export const getWorkflowExecutions = async (
  workflowId: string,
  limit: number = 20
): Promise<N8nExecution[]> => {
  try {
    const response = await n8nClient.get('/executions', {
      params: { workflowId, limit, includeData: false },
    });
    return response.data.data || [];
  } catch (error) {
    logger.error(`Failed to get executions for workflow ${workflowId}:`, error);
    return [];
  }
};

export const triggerWebhook = async (
  webhookUrl: string,
  data: Record<string, unknown>
): Promise<{ success: boolean; response?: unknown; error?: string }> => {
  try {
    const response = await axios.post(webhookUrl, data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return { success: true, response: response.data };
  } catch (error) {
    const errMsg = (error as Error).message;
    logger.error(`Failed to trigger webhook ${webhookUrl}:`, error);
    return { success: false, error: errMsg };
  }
};

export const getDefaultWorkflowTemplates = () => {
  return [
    {
      id: 'gmail-trigger',
      name: 'Gmail Lead Trigger',
      description: 'Triggered when a new lead is extracted from Gmail',
      type: 'lead_extraction',
      json: {
        name: 'Gmail Lead Trigger',
        nodes: [
          {
            parameters: { httpMethod: 'POST', path: 'gmail-lead', responseMode: 'lastNode', responseData: 'allEntries' },
            id: 'webhook-node',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1,
            position: [250, 300],
          },
          {
            parameters: {
              conditions: { boolean: [{ value1: '={{$json["isLead"]}}', value2: true }] },
            },
            id: 'if-node',
            name: 'Is Lead?',
            type: 'n8n-nodes-base.if',
            typeVersion: 1,
            position: [450, 300],
          },
          {
            parameters: {
              method: 'POST',
              url: `${config.frontendUrl}/api/notifications`,
              sendBody: true,
              bodyParameters: { parameters: [{ name: 'leadData', value: '={{$json}}' }] },
            },
            id: 'http-node',
            name: 'Notify Team',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 3,
            position: [650, 200],
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Is Lead?', type: 'main', index: 0 }]] },
          'Is Lead?': { main: [[{ node: 'Notify Team', type: 'main', index: 0 }]] },
        },
      },
    },
    {
      id: 'auto-reply',
      name: 'Auto Reply Workflow',
      description: 'Sends automated reply to leads',
      type: 'auto_reply',
      json: {
        name: 'Auto Reply Workflow',
        nodes: [
          {
            parameters: { httpMethod: 'POST', path: 'auto-reply', responseMode: 'lastNode' },
            id: 'webhook-node',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1,
            position: [250, 300],
          },
          {
            parameters: {
              fromEmail: '={{$json["fromEmail"]}}',
              toEmail: '={{$json["customerEmail"]}}',
              subject: 'Thank you for your enquiry!',
              text: 'We have received your request and will be in touch shortly.',
            },
            id: 'email-node',
            name: 'Send Email',
            type: 'n8n-nodes-base.emailSend',
            typeVersion: 1,
            position: [450, 300],
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Send Email', type: 'main', index: 0 }]] },
        },
      },
    },
    {
      id: 'crm-sync',
      name: 'CRM Sync',
      description: 'Syncs leads to your CRM system via HTTP',
      type: 'notification',
      json: {
        name: 'CRM Sync Workflow',
        nodes: [
          {
            parameters: { httpMethod: 'POST', path: 'crm-sync' },
            id: 'webhook-node',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1,
            position: [250, 300],
          },
          {
            parameters: {
              method: 'POST',
              url: 'https://your-crm.com/api/leads',
              sendBody: true,
              bodyParameters: { parameters: [{ name: 'lead', value: '={{$json}}' }] },
            },
            id: 'crm-http-node',
            name: 'Push to CRM',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 3,
            position: [450, 300],
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Push to CRM', type: 'main', index: 0 }]] },
        },
      },
    },
    {
      id: 'slack-notification',
      name: 'Slack Lead Alert',
      description: 'Posts a message to Slack when a new lead arrives',
      type: 'notification',
      json: {
        name: 'Slack Lead Alert',
        nodes: [
          {
            parameters: { httpMethod: 'POST', path: 'slack-lead' },
            id: 'webhook-node',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1,
            position: [250, 300],
          },
          {
            parameters: {
              method: 'POST',
              url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK',
              sendBody: true,
              bodyParameters: {
                parameters: [{
                  name: 'text',
                  value: '=🔔 New lead: *{{$json["customerName"]}}* ({{$json["customerEmail"]}}) — {{$json["rawEmailSubject"]}}',
                }],
              },
            },
            id: 'slack-node',
            name: 'Slack Message',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 3,
            position: [450, 300],
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Slack Message', type: 'main', index: 0 }]] },
        },
      },
    },
    {
      id: 'google-sheets-log',
      name: 'Google Sheets Logger',
      description: 'Logs every lead to a Google Sheet for easy tracking',
      type: 'custom',
      json: {
        name: 'Google Sheets Logger',
        nodes: [
          {
            parameters: { httpMethod: 'POST', path: 'sheets-log' },
            id: 'webhook-node',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1,
            position: [250, 300],
          },
          {
            parameters: {
              operation: 'append',
              documentId: 'YOUR_GOOGLE_SHEET_ID',
              sheetName: 'Leads',
              columns: {
                mappingMode: 'defineBelow',
                value: {
                  Name: '={{$json["customerName"]}}',
                  Email: '={{$json["customerEmail"]}}',
                  Phone: '={{$json["customerPhone"]}}',
                  Date: '={{$json["movingDate"]}}',
                  Status: '={{$json["status"]}}',
                  Confidence: '={{$json["confidence"]}}',
                  Created: '={{$json["createdAt"]}}',
                },
              },
            },
            id: 'sheets-node',
            name: 'Append to Sheet',
            type: 'n8n-nodes-base.googleSheets',
            typeVersion: 4,
            position: [450, 300],
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Append to Sheet', type: 'main', index: 0 }]] },
        },
      },
    },
    {
      id: 'follow-up-sequence',
      name: 'Follow-up Sequence',
      description: 'Sends a follow-up email 24 hours after the initial auto-reply',
      type: 'auto_reply',
      json: {
        name: 'Follow-up Sequence',
        nodes: [
          {
            parameters: { httpMethod: 'POST', path: 'follow-up' },
            id: 'webhook-node',
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            typeVersion: 1,
            position: [250, 300],
          },
          {
            parameters: { amount: 1, unit: 'days' },
            id: 'wait-node',
            name: 'Wait 24h',
            type: 'n8n-nodes-base.wait',
            typeVersion: 1,
            position: [450, 300],
          },
          {
            parameters: {
              fromEmail: '={{$json["fromEmail"]}}',
              toEmail: '={{$json["customerEmail"]}}',
              subject: 'Following up on your enquiry',
              text: 'Hi {{$json["customerName"]}},\n\nJust following up on your recent enquiry. We would love to help — are you still interested?\n\nBest regards',
            },
            id: 'email-node',
            name: 'Send Follow-up',
            type: 'n8n-nodes-base.emailSend',
            typeVersion: 1,
            position: [650, 300],
          },
        ],
        connections: {
          Webhook: { main: [[{ node: 'Wait 24h', type: 'main', index: 0 }]] },
          'Wait 24h': { main: [[{ node: 'Send Follow-up', type: 'main', index: 0 }]] },
        },
      },
    },
  ];
};

export default {
  createWorkflow,
  activateWorkflow,
  deactivateWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  getWorkflowExecutions,
  triggerWebhook,
  getDefaultWorkflowTemplates,
};
