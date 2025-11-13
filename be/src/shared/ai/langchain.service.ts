// @ts-nocheck
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { OpenAI, ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  PromptTemplate,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import { BaseLanguageModel } from '@langchain/core/language_models/base';
import { Document } from '@langchain/core/documents';
import aiConfig from './ai.config';
import { Activity } from '@prisma/client';
import { Chroma } from '@langchain/community/vectorstores/chroma';
import { Where } from 'chromadb';
import { PrismaService } from '../../core/database/prisma.service';

// At the top of the file, add interface
interface ActivityMetadata {
  timeOfDayPreference?: string[];
  physicalIntensity?: number;
  enhancedDescription?: string;
  targetAudience?: string;
  bestTimeToVisit?: string;
  tags?: string[];
  complementaryActivities?: {
    before?: string[];
    after?: string[];
  };
  seasonalityScore?: any;
  combinationScore?: any;
}

@Injectable()
export class LangChainService {
  private readonly logger = new Logger(LangChainService.name);
  private chatModel: any;
  private completionModel: any;

  private embeddings: any;
  private vectorStore: Chroma | null = null; // optional if embeddings disabled

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
    private readonly prisma: PrismaService,
  ) {
    // Initialize models
    this.initializeModels();
    this.initializeVectorStore();
  }

  // Minimal HTTP adapter for Ollama embeddings API
  private createOllamaEmbeddingsAdapter(baseUrl: string, model: string) {
    return {
      embedDocuments: async (texts: string[]) => {
        const vectors: number[][] = [];
        for (const text of texts) {
          const resp = await fetch(`${baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input: text }),
          } as any);
          if (!resp.ok) throw new Error(`Ollama embeddings error ${resp.status}`);
          const data = await resp.json();
          vectors.push(data.embedding || data.data?.[0]?.embedding);
        }
        return vectors;
      },
      embedQuery: async (text: string) => {
        const resp = await fetch(`${baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, input: text }),
        } as any);
        if (!resp.ok) throw new Error(`Ollama embeddings error ${resp.status}`);
        const data = await resp.json();
        return data.embedding || data.data?.[0]?.embedding;
      },
    } as any;
  }

  async initializeVectorStore() {
    try {
      const provider = this.config.provider;
      const collectionName = this.config.chromaCollectionName || 'activities';

      if (provider === 'ollama') {
        const baseUrl = this.config.ollamaBaseUrl!;
        const model = this.config.embeddingsModel || 'nomic-embed-text';
        this.embeddings = this.createOllamaEmbeddingsAdapter(baseUrl, model);

        if (this.config.chromaUrl) {
          this.vectorStore = await Chroma.fromDocuments(
            [],
            this.embeddings,
            { collectionName, url: this.config.chromaUrl } as any,
          );
        } else {
          this.vectorStore = await Chroma.fromDocuments([], this.embeddings, { collectionName });
        }
        this.logger.log(`Chroma initialized with Ollama embeddings (model=${model}).`);
        return;
      }

      if (provider === 'openai' && this.config.openaiApiKey) {
        this.embeddings = new OpenAIEmbeddings({ openAIApiKey: this.config.openaiApiKey });
        if (this.config.chromaUrl) {
          this.vectorStore = await Chroma.fromDocuments(
            [],
            this.embeddings,
            { collectionName, url: this.config.chromaUrl } as any,
          );
        } else {
          this.vectorStore = await Chroma.fromDocuments([], this.embeddings, { collectionName });
        }
        this.logger.log('Chroma initialized with OpenAI embeddings.');
        return;
      }

      // Groq u otros: intentar Ollama embeddings si baseUrl está configurado
      if (provider === 'groq' && this.config.ollamaBaseUrl) {
        this.embeddings = this.createOllamaEmbeddingsAdapter(
          this.config.ollamaBaseUrl!,
          this.config.embeddingsModel || 'nomic-embed-text',
        );
        this.vectorStore = await Chroma.fromDocuments([], this.embeddings, { collectionName });
        this.logger.log('Chroma initialized with Ollama embeddings (provider=groq).');
        return;
      }

      this.embeddings = null;
      this.vectorStore = null;
      this.logger.warn('Embeddings disabled (no compatible provider configured).');
    } catch (e) {
      this.logger.error('Failed to initialize vector store', e);
      this.embeddings = null;
      this.vectorStore = null;
    }
  }

  async saveActivityEmbedding(activities: Activity[]) {
    const docs = activities.map((activity) => {
      return new Document({
        pageContent: `Name: ${activity.name}. Description: ${activity.description}. Metadata: ${activity.metadata}`,
        metadata: activity,
      });
    });

    if (!this.embeddings || !this.vectorStore) return;
    const embedding = await this.embeddings.embedDocuments(
      docs.map((doc) => doc.pageContent),
    );
    await this.vectorStore.addVectors(embedding, docs, {
      ids: activities.map((activity) => activity.id.toString()),
    });
  }

  async addActivityToVectorStore(activity: Activity) {
    let metadata: ActivityMetadata = {};
    // Parse the metadata if it's stored as a string
    try {
      metadata =
        typeof activity.metadata === 'string'
          ? JSON.parse(activity.metadata)
          : activity.metadata || {};
    } catch (error) {
      console.warn(
        `Error parsing metadata for activity ${activity.id}:`,
        error,
      );
      metadata = {};
    }

    // Create a rich text representation
    const activityText = `Activity Details:
${activity.name} is a ${metadata.physicalIntensity || 3} intensity activity.
About this activity: ${activity.description || 'No description available'}
${metadata.enhancedDescription || ''}
This activity is ideal for ${metadata.targetAudience || 'all audiences'} and is best experienced ${metadata.bestTimeToVisit || 'any time'}.
It can be done during ${metadata.timeOfDayPreference ? metadata.timeOfDayPreference.join(', ') : 'any time of day'}.
Activity type: ${activity.type}.
Keywords: ${metadata.tags ? metadata.tags.join(', ') : ''}.

Related Activities:
Before this activity, consider: ${metadata.complementaryActivities?.before ? metadata.complementaryActivities.before.join(', ') : 'flexible'}.
After this activity, you can try: ${metadata.complementaryActivities?.after ? metadata.complementaryActivities.after.join(', ') : 'flexible'}.
`;

    if (!this.vectorStore) return;
    await this.vectorStore.addDocuments([
      {
        pageContent: activityText,
        id: activity.id, // Usar el ID como string (ObjectId)
        metadata: {
          activityId: activity.id, // CRÍTICO: Siempre string
          activityName: activity.name,
          activityType: activity.type,
          activityMetadata: activity.metadata,
          // Campos específicos para filtrado
          tags: metadata.tags || [],
          timeOfDay: metadata.timeOfDayPreference || [],
          seasonality: metadata.seasonalityScore || {},
          physicalIntensity: metadata.physicalIntensity || 3,
          combinationScore: metadata.combinationScore || {},
          complementaryBefore: metadata.complementaryActivities?.before || [],
          complementaryAfter: metadata.complementaryActivities?.after || [],
        },
      },
    ]);
  }

  async findSimilarActivities(prompt: string, k: number = 10, filter?: Where) {
    if (!this.vectorStore) return [] as any[];
    const results = await this.vectorStore.similaritySearch(prompt, k, {
      ...filter,
    });
    return results;
  }

  private initializeModels(): void {
    try {
      const provider = this.config.provider;
      if (!this.config.enableAi) {
        this.logger.warn('AI disabled via ENABLE_AI=false');
        return;
      }
      if (provider === 'openai') {
        const commonOptions = {
          openAIApiKey: this.config.openaiApiKey,
          temperature: this.config.temperature,
          timeout: this.config.timeout,
        };
        this.chatModel = new ChatOpenAI({
          ...commonOptions,
          modelName: this.config.defaultModel,
        });
        this.completionModel = new OpenAI({
          ...commonOptions,
          modelName: 'gpt-3.5-turbo-instruct',
        });
      } else {
        // For ollama/groq we use HTTP endpoints in generateChatResponse/generateCompletionResponse
        this.chatModel = null;
        this.completionModel = null;
      }

      this.logger.log('AI models initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize AI models', error);
      throw error;
    }
  }

  /**
   * Get the ChatOpenAI model instance
   */
  getChatModel(
    customOptions?: Partial<ConstructorParameters<typeof ChatOpenAI>[0]>,
  ): ChatOpenAI {
    if (customOptions) {
      return new ChatOpenAI({
        openAIApiKey: this.config.openaiApiKey,
        temperature: this.config.temperature,
        timeout: this.config.timeout,
        modelName: this.config.defaultModel,
        ...customOptions,
      });
    }
    return this.chatModel;
  }

  /**
   * Get the OpenAI completion model instance
   */
  getCompletionModel(
    customOptions?: Partial<ConstructorParameters<typeof OpenAI>[0]>,
  ): OpenAI {
    if (customOptions) {
      return new OpenAI({
        openAIApiKey: this.config.openaiApiKey,
        temperature: this.config.temperature,
        timeout: this.config.timeout,
        modelName: 'text-davinci-003',
        ...customOptions,
      });
    }
    return this.completionModel;
  }

  /**
   * Create a simple prompt template
   */
  createPromptTemplate(
    template: string,
    inputVariables?: string[],
  ): PromptTemplate {
    // The new API automatically extracts input variables from the template
    // If specific inputVariables are provided, we can use them with a different approach
    if (inputVariables && inputVariables.length > 0) {
      return new PromptTemplate({ template, inputVariables });
    }
    // Otherwise let the fromTemplate method extract variables automatically
    return PromptTemplate.fromTemplate(template);
  }

  /**
   * Create a simple chain with a language model
   */
  createChain(
    promptTemplate: PromptTemplate,
    model: BaseLanguageModel = this.chatModel,
  ): RunnableSequence {
    return RunnableSequence.from([
      promptTemplate,
      model,
      new StringOutputParser(),
    ]);
  }

  async generateChatResponse(
    systemPrompt: string,
    userPrompt: string,
    variables: Record<string, string> = {},
    customOptions?: Partial<ConstructorParameters<typeof ChatOpenAI>[0]>,
  ): Promise<string> {
    try {
      const provider = this.config.provider;
      if (provider === 'ollama') {
        // Format combined prompt
        const combined = PromptTemplate.fromTemplate(`${systemPrompt}\n${userPrompt}`);
        const promptText = await combined.format(variables as any);
        const resp = await fetch(`${this.config.ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.defaultModel || 'llama3.1',
            prompt: promptText,
            stream: false,
            options: { temperature: this.config.temperature },
          }),
        } as any);
        if (!resp.ok) throw new Error(`Ollama error ${resp.status}`);
        const data = await resp.json();
        return data.response as string;
      }

      if (provider === 'groq') {
        const userTmpl = PromptTemplate.fromTemplate(userPrompt);
        const userText = await userTmpl.format(variables as any);
        const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.groqApiKey}`,
          },
          body: JSON.stringify({
            model: this.config.defaultModel || 'llama-3.1-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userText },
            ],
            temperature: this.config.temperature,
          }),
        } as any);
        if (!resp.ok) throw new Error(`Groq error ${resp.status}`);
        const data = await resp.json();
        return data.choices?.[0]?.message?.content || '';
      }

      // Default: OpenAI via LangChain
      const model = customOptions ? this.getChatModel(customOptions) : this.chatModel;
      const chatPrompt = ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(systemPrompt),
        HumanMessagePromptTemplate.fromTemplate(userPrompt),
      ]);
      const chain = RunnableSequence.from([chatPrompt, model, new StringOutputParser()]);
      return await chain.invoke(variables);
    } catch (error) {
      this.logger.error(`Error generating chat response: ${error.message}`);
      throw error;
    }
  }

  /**
   * Run a simple prompt with the completion model
   */
  async generateCompletionResponse(
    promptText: string,
    variables: Record<string, string> = {},
    customOptions?: Partial<ConstructorParameters<typeof OpenAI>[0]>,
  ): Promise<string> {
    try {
      const provider = this.config.provider;
      if (provider === 'ollama') {
        const tmpl = PromptTemplate.fromTemplate(promptText);
        const text = await tmpl.format(variables as any);
        const resp = await fetch(`${this.config.ollamaBaseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.defaultModel || 'llama3.1',
            prompt: text,
            stream: false,
            options: { temperature: this.config.temperature },
          }),
        } as any);
        if (!resp.ok) throw new Error(`Ollama error ${resp.status}`);
        const data = await resp.json();
        return data.response as string;
      }

      if (provider === 'groq') {
        const tmpl = PromptTemplate.fromTemplate(promptText);
        const text = await tmpl.format(variables as any);
        const resp = await fetch('https://api.groq.com/openai/v1/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.groqApiKey}`,
          },
          body: JSON.stringify({
            model: this.config.defaultModel || 'llama-3.1-70b-versatile',
            prompt: text,
            temperature: this.config.temperature,
          }),
        } as any);
        if (!resp.ok) throw new Error(`Groq error ${resp.status}`);
        const data = await resp.json();
        return data.choices?.[0]?.text || '';
      }

      const model = customOptions ? this.getCompletionModel(customOptions) : this.completionModel;
      const prompt = PromptTemplate.fromTemplate(promptText);
      const chain = this.createChain(prompt, model);
      return await chain.invoke(variables);
    } catch (error) {
      this.logger.error(
        `Error generating completion response: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Analyze relationships between activities using AI
   * @param prompt The formatted prompt containing activity details
   * @returns A JSON string containing relationship analysis
   */
  async analyzeActivity(activity: Activity, distanceKm: number): Promise<any> {
    const prompt = new PromptTemplate({
      template: `As an AI expert in activity planning and tourism, analyze this activity 
Activity
Name: {name}
Type: {type}
Duration: {duration} minutes
Description: {description}
Metadata: {metadata}

Physical distance: {distanceKm} km


Evaluate and provide a JSON response with:
1. Scores (0-100):
   - compatibilityScore: Overall compatibility
   - timeCompatibilityScore: How well their durations and timing work together
   - distanceScore: Score based on physical distance
   - varietyScore: How well they complement each other in terms of variety
2.    Provide a structured analysis following the specified format  metadata: {{
      enhancedDescription: string;
      tags: string[];
      targetAudience: string;
      bestTimeToVisit: string;
      accessibilityInfo: string;
      recommendedEquipment: string;
      culturalRelevance: string;
      sustainabilityRating: number;
      localTips: string;
      weatherConsiderations: string;
      potentialNextActivitiesTypes: string[];
    }}

Response format:
{{
  "compatibilityScore": number,
  "timeCompatibilityScore": number,
  "distanceScore": number,
  "varietyScore": number,
  "relationType": string,
  "reasoning": string,
  "timeGapRecommended": number,
  "enhancedDescription": string,
  "tags": string[],
  "targetAudience": string,
  "bestTimeToVisit": string,
  "accessibilityInfo": string,
  "recommendedEquipment": string,
  "culturalRelevance": string,
  "sustainabilityRating": number,
  "localTips": string,
  "weatherConsiderations": string,
  "potentialNextActivitiesTypes": string[],
}}
`,
      inputVariables: [
        'name',
        'type',
        'duration',
        'description',
        'metadata',
        'distanceKm',
      ],
    });

    try {
      const resultText = await this.generateCompletionResponse(
        prompt.template as string,
        {
          name: activity.name,
          type: activity.type,
          duration: String(activity.duration),
          description: activity.description || '',
          metadata: JSON.stringify(activity.metadata || ''),
          distanceKm: distanceKm.toFixed(1),
        } as any,
      );

      return JSON.parse(resultText);
    } catch (error) {
      console.error('Error analyzing activity relationship:', error);
      throw new Error('Failed to analyze activity relationship');
    }
  }

  async resetVectorStore() {
    try {
      console.log('Resetting vector store...');

      // Opción B: Reinicializar completamente
      this.vectorStore = await Chroma.fromDocuments(
        [], // Empezar vacío
        this.embeddings,
        {
          collectionName: 'activities', // Nuevo nombre para evitar conflictos
        },
      );

      console.log('Vector store reset successfully');
    } catch (error) {
      console.error('Error resetting vector store:', error);
      throw error;
    }
  }

  async rebuildVectorStore() {
    try {
      // 1. Reset vector store
      await this.resetVectorStore();

      // 2. Get all activities from database
      const activities = await this.prisma.activity.findMany({
        where: {
          metadata: { not: null }, // Solo actividades con metadata
        },
      });

      console.log(
        `Rebuilding vector store with ${activities.length} activities...`,
      );

      // 3. Add all activities to vector store with consistent IDs
      for (const activity of activities) {
        try {
          await this.addActivityToVectorStore(activity);
          console.log(`Added activity ${activity.id}: ${activity.name}`);
        } catch (error) {
          console.error(`Error adding activity ${activity.id}:`, error);
        }
      }

      console.log('Vector store rebuilt successfully');
      return { success: true, count: activities.length };
    } catch (error) {
      console.error('Error rebuilding vector store:', error);
      throw error;
    }
  }
}
