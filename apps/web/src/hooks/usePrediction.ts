import { useSyncExternalStore } from 'react'
import { predictionStore, type PredictionState } from '@/lib/prediction-store'

export function usePrediction(): PredictionState {
  return useSyncExternalStore(predictionStore.subscribe, predictionStore.getSnapshot, predictionStore.getSnapshot)
}
