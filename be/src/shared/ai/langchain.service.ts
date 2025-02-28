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
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class LangChainService {
  private readonly logger = new Logger(LangChainService.name);
  private chatModel: ChatOpenAI;
  private completionModel: OpenAI;

  private embeddings: OpenAIEmbeddings;
  private vectorStore: Chroma; // or FaissStore

  constructor(
    @Inject(aiConfig.KEY)
    private readonly config: ConfigType<typeof aiConfig>,
    private readonly prisma: PrismaService,
  ) {
    // Initialize models
    this.initializeModels();
    this.initializeVectorStore();
  }

  async initializeVectorStore() {
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: this.config.openaiApiKey,
    });

    // Initialize vector store
    this.vectorStore = await Chroma.fromDocuments(
      [], // initial documents
      this.embeddings,
      {
        collectionName: 'activities',
      },
    );
  }

  async saveActivityEmbedding(activities: Activity[]) {
    const docs = activities.map((activity) => {
      return new Document({
        pageContent: `Name: ${activity.name}. Description: ${activity.description}. Metadata: ${activity.metadata}`,
        metadata: activity,
      });
    });

    const embedding = await this.embeddings.embedDocuments(
      docs.map((doc) => doc.pageContent),
    );
    await this.vectorStore.addVectors(embedding, docs, {
      ids: activities.map((activity) => activity.id.toString()),
    });
  }

  async addActivityToVectorStore(activity: Activity) {
    // Parse the metadata if it's stored as a string
    const metadata =
      typeof activity.metadata === 'string'
        ? JSON.parse(activity.metadata)
        : activity.metadata;

    // Create a rich text representation that includes semantic information
    const activityText = `Activity Details:
  ${activity.name} is a ${metadata.physicalIntensity || ''} intensity activity.
  About this activity: ${activity.description}
  ${metadata.enhancedDescription || ''}
  This activity is ideal for ${metadata.targetAudience || 'all audiences'} and is best experienced ${metadata.bestTimeToVisit || 'any time'}.
  It can be done during ${metadata.timeOfDayPreference ? metadata.timeOfDayPreference.join(', ') : 'any time of day'}.
  Activity type: ${metadata.indoorOutdoor || ''}.
  Keywords: ${metadata.tags ? metadata.tags.join(', ') : ''}.
  
  Related Activities:
  Before this activity, consider: ${metadata.complementaryActivities?.before ? metadata.complementaryActivities.before.join(', ') : 'flexible'}.
  After this activity, you can try: ${metadata.complementaryActivities?.after ? metadata.complementaryActivities.after.join(', ') : 'flexible'}.
`;

    await this.vectorStore.addDocuments([
      {
        pageContent: activityText,
        id: activity.id.toString(),
        metadata: {
          activityId: activity.id,
          activityMetadata: activity.metadata,
          // Add specific metadata fields for filtering
          tags: metadata.tags || [],
          timeOfDay: metadata.timeOfDayPreference || [],
          seasonality: metadata.seasonalityScore || {},
          physicalIntensity: metadata.physicalIntensity || 0,
          combinationScore: metadata.combinationScore || {},
          complementaryBefore: metadata.complementaryActivities?.before || [],
          complementaryAfter: metadata.complementaryActivities?.after || [],
        },
      },
    ]);
  }

  async findSimilarActivities(prompt: string, k: number = 10, filter?: Where) {
    const results = await this.vectorStore.similaritySearch(prompt, k, {
      ...filter,
    });
    return results;
  }

  private initializeModels(): void {
    try {
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
        modelName: 'text-davinci-003', // Default completion model
      });

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
      const model = customOptions
        ? this.getChatModel(customOptions)
        : this.chatModel;

      const chatPrompt = ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(systemPrompt),
        HumanMessagePromptTemplate.fromTemplate(userPrompt),
      ]);

      const chain = RunnableSequence.from([
        chatPrompt,
        model,
        new StringOutputParser(),
      ]);

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
      const model = customOptions
        ? this.getCompletionModel(customOptions)
        : this.completionModel;
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
      const formattedPrompt = await prompt.format({
        name: activity.name,
        type: activity.type,
        duration: activity.duration,
        description: activity.description || '',
        distanceKm: distanceKm.toFixed(1),
        metadata: activity.metadata || '',
      });

      const result = await this.chatModel.invoke(formattedPrompt);

      const analysis = JSON.parse(result.content.toString());

      return analysis;
    } catch (error) {
      console.error('Error analyzing activity relationship:', error);
      throw new Error('Failed to analyze activity relationship');
    }
  }
}
