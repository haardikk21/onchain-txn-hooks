import type { DetectedEvent, VariableReference } from 'shared/dist';

export class VariableResolver {
  /**
   * Resolve all variables from a detected event and system context
   */
  static resolveVariables(
    event: DetectedEvent,
    variables: VariableReference[],
    userWalletAddress: string
  ): Record<string, any> {
    const resolvedValues: Record<string, any> = {};

    for (const variable of variables) {
      try {
        const value = this.resolveSingleVariable(event, variable, userWalletAddress);
        if (value !== undefined) {
          resolvedValues[variable.name] = value;
        } else {
          console.warn(`Failed to resolve variable: ${variable.name}`);
        }
      } catch (error) {
        console.error(`Error resolving variable ${variable.name}:`, error);
      }
    }

    return resolvedValues;
  }

  /**
   * Resolve a single variable based on its type and path
   */
  private static resolveSingleVariable(
    event: DetectedEvent,
    variable: VariableReference,
    userWalletAddress: string
  ): any {
    switch (variable.type) {
      case 'event':
        return this.resolveEventVariable(event, variable.path);
      case 'system':
        return this.resolveSystemVariable(event, variable.path, userWalletAddress);
      case 'user':
        return this.resolveUserVariable(variable.path, userWalletAddress);
      default:
        console.warn(`Unknown variable type: ${variable.type}`);
        return undefined;
    }
  }

  /**
   * Resolve event-based variables using dot notation path
   */
  private static resolveEventVariable(event: DetectedEvent, path: string): any {
    // Parse the path (e.g., "args.token0", "blockNumber", "transactionHash")
    const pathParts = path.split('.');
    
    let current: any = event;
    for (const part of pathParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        console.warn(`Event path not found: ${path}`);
        return undefined;
      }
    }

    // Convert BigInt to string for JSON serialization
    if (typeof current === 'bigint') {
      return current.toString();
    }

    return current;
  }

  /**
   * Resolve system variables (block info, timestamps, etc.)
   */
  private static resolveSystemVariable(
    event: DetectedEvent,
    path: string,
    userWalletAddress: string
  ): any {
    switch (path) {
      case 'block.number':
        return event.blockNumber.toString();
      case 'block.timestamp':
        return event.timestamp.toString();
      case 'transaction.hash':
        return event.transactionHash;
      case 'event.logIndex':
        return event.logIndex.toString();
      case 'event.contractAddress':
        return event.signature.contractAddress;
      case 'user.walletAddress':
        return userWalletAddress;
      default:
        console.warn(`Unknown system variable path: ${path}`);
        return undefined;
    }
  }

  /**
   * Resolve user-specific variables (user wallet, preferences, etc.)
   */
  private static resolveUserVariable(path: string, userWalletAddress: string): any {
    switch (path) {
      case 'walletAddress':
        return userWalletAddress;
      default:
        console.warn(`Unknown user variable path: ${path}`);
        return undefined;
    }
  }

  /**
   * Validate that all required variables can be resolved from an event signature
   */
  static validateVariablesForEvent(
    variables: VariableReference[],
    eventSignature: any // ABI event signature
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const variable of variables) {
      if (variable.type === 'event') {
        const pathParts = variable.path.split('.');
        
        // Check if path starts with a valid event property
        if (pathParts[0] === 'args') {
          // Validate that the argument exists in the event ABI
          if (pathParts.length > 1) {
            const argName = pathParts[1];
            const eventInputs = eventSignature?.inputs || [];
            const inputExists = eventInputs.some((input: any) => input.name === argName);
            
            if (!inputExists) {
              errors.push(`Variable ${variable.name} references non-existent event argument: ${argName}`);
            }
          }
        } else if (!['blockNumber', 'transactionHash', 'logIndex', 'timestamp'].includes(pathParts[0] || '')) {
          errors.push(`Variable ${variable.name} uses invalid event path: ${variable.path}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get all available variable paths for an event signature
   */
  static getAvailableVariablePaths(eventSignature: any): Array<{
    name: string;
    path: string;
    type: 'event' | 'system' | 'user';
    description: string;
    valueType: string;
  }> {
    const paths: Array<{
      name: string;
      path: string;
      type: 'event' | 'system' | 'user';
      description: string;
      valueType: string;
    }> = [];

    // Add system variables
    paths.push(
      { name: '$blockNumber', path: 'block.number', type: 'system', description: 'Block number', valueType: 'uint256' },
      { name: '$blockTimestamp', path: 'block.timestamp', type: 'system', description: 'Block timestamp', valueType: 'uint256' },
      { name: '$txHash', path: 'transaction.hash', type: 'system', description: 'Transaction hash', valueType: 'bytes32' },
      { name: '$logIndex', path: 'event.logIndex', type: 'system', description: 'Log index', valueType: 'uint256' },
      { name: '$contractAddress', path: 'event.contractAddress', type: 'system', description: 'Event contract address', valueType: 'address' },
      { name: '$userWallet', path: 'user.walletAddress', type: 'system', description: 'User wallet address', valueType: 'address' }
    );

    // Add user variables
    paths.push(
      { name: '$wallet', path: 'walletAddress', type: 'user', description: 'User wallet address', valueType: 'address' }
    );

    // Add event argument variables
    const eventInputs = eventSignature?.inputs || [];
    for (const input of eventInputs) {
      paths.push({
        name: `$${input.name}`,
        path: `args.${input.name}`,
        type: 'event',
        description: `Event argument: ${input.name}`,
        valueType: input.type,
      });
    }

    return paths;
  }

  /**
   * Extract variable references from a template string
   */
  static extractVariableReferences(templateString: string): string[] {
    const variableRegex = /\$\{([^}]+)\}/g;
    const matches: string[] = [];
    let match;

    while ((match = variableRegex.exec(templateString)) !== null) {
      if (match[1]) {
        matches.push(match[1]);
      }
    }

    return matches;
  }
}