/**
 * Coupe-circuit par modèle, en mémoire du worker. Après `threshold` échecs OVERLOADED consécutifs,
 * le modèle est écarté pendant `cooldownMs` ; ensuite un seul appel test est autorisé : s'il
 * réussit le modèle redevient disponible, s'il échoue encore (OVERLOADED) il repart pour un cooldown.
 */
export class CircuitBreaker {
  private readonly states = new Map<string, { failures: number; openUntil: number; probing: boolean }>();

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private state(model: string) {
    let state = this.states.get(model);
    if (!state) {
      state = { failures: 0, openUntil: 0, probing: false };
      this.states.set(model, state);
    }
    return state;
  }

  /** Le modèle peut-il être appelé maintenant ? (réserve l'appel test après un cooldown) */
  tryAcquire(model: string): boolean {
    const state = this.state(model);
    if (state.openUntil === 0) return true;
    if (this.now() < state.openUntil || state.probing) return false;
    state.probing = true;
    return true;
  }

  isOpen(model: string): boolean {
    const state = this.state(model);
    return state.openUntil !== 0 && (this.now() < state.openUntil || state.probing);
  }

  recordSuccess(model: string): void {
    this.states.set(model, { failures: 0, openUntil: 0, probing: false });
  }

  /** Échec OVERLOADED. Renvoie true si le modèle vient d'être écarté. */
  recordOverload(model: string): boolean {
    const state = this.state(model);
    state.failures++;
    if (state.probing || state.failures >= this.threshold) {
      state.openUntil = this.now() + this.cooldownMs;
      state.probing = false;
      return true;
    }
    return false;
  }

  /** Autre échec (timeout, réseau…) : ne compte pas pour le seuil, libère l'appel test. */
  recordOtherFailure(model: string): void {
    this.state(model).probing = false;
  }
}
