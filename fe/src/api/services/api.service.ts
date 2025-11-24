import { AxiosError } from 'axios';
import axiosInstance from '../config/axios';

export interface ApiResponse<T> {
  data: T;
  error: string | null;
  status: number;
}

export class ApiService<T> {
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  private handleError(error: AxiosError): ApiResponse<T> {
    return {
      data: null as T,
      error:
        (error.response?.data as { message: string })?.message ||
        'An error occurred',
      status: error.response?.status || 500,
    };
  }

  async getAll(): Promise<ApiResponse<T[]>> {
    try {
      const response = await axiosInstance.get<T[]>(this.endpoint);
      return { data: response.data, error: null, status: 200 };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  async getById(id: string | number): Promise<ApiResponse<T>> {
    try {
      const response = await axiosInstance.get<T>(`${this.endpoint}/${id}`);
      return { data: response.data, error: null, status: 200 };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  async create(data: Partial<T>): Promise<ApiResponse<T>> {
    try {
      const response = await axiosInstance.post<T>(this.endpoint, data);
      return { data: response, error: null, status: 201 };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  async update(id: string | number, data: Partial<T>): Promise<ApiResponse<T>> {
    try {
      const response = await axiosInstance.put<T>(
        `${this.endpoint}/${id}`,
        data
      );
      return { data: response.data, error: null, status: 200 };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }

  async delete(id: string | number): Promise<ApiResponse<void>> {
    try {
      await axiosInstance.delete(`${this.endpoint}/${id}`);
      return { data: undefined, error: null, status: 204 };
    } catch (error) {
      return this.handleError(error as AxiosError);
    }
  }
}
