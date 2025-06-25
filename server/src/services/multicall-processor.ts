import { encodeFunctionData, type Address, type Hash } from 'viem';
import type { TransactionTemplate, DetectedEvent, TransactionCall, VariableReference } from 'shared/dist';
import { VariableResolver } from './variable-resolver';

export interface ProcessedMulticall {
  id: string;
  templateId: string;
  eventId: string;
  calls: ProcessedCall[];
  totalValue: string;
  estimatedGas: string;
  resolvedVariables: Record<string, any>;
  createdAt: number;
}

export interface ProcessedCall {
  target: Address;
  value: string;
  calldata: Hash;
  originalCall: TransactionCall;
}

export class MulticallProcessor {
  /**
   * Process a transaction template with event data to create executable multicall
   */
  static processTemplate(
    template: TransactionTemplate,
    event: DetectedEvent,
    userWalletAddress: string
  ): ProcessedMulticall | null {
    try {
      // Resolve all variables from the event and context
      const resolvedVariables = VariableResolver.resolveVariables(
        event,
        template.requiredVariables,
        userWalletAddress
      );

      // Check if all required variables were resolved
      const missingVariables = this.findMissingVariables(template.requiredVariables, resolvedVariables);
      if (missingVariables.length > 0) {
        console.error(`Missing required variables: ${missingVariables.join(', ')}`);
        return null;
      }

      // Process each call in the template
      const processedCalls: ProcessedCall[] = [];
      let totalValue = BigInt(0);

      for (const call of template.calls) {
        const processedCall = this.processCall(call, resolvedVariables);
        if (!processedCall) {
          console.error('Failed to process call in template');
          return null;
        }
        
        processedCalls.push(processedCall);
        totalValue += BigInt(processedCall.value);
      }

      return {
        id: `multicall_${event.transactionHash}_${template.id}_${Date.now()}`,
        templateId: template.id,
        eventId: `${event.transactionHash}_${event.logIndex}`,
        calls: processedCalls,
        totalValue: totalValue.toString(),
        estimatedGas: template.estimatedGas.toString(),
        resolvedVariables,
        createdAt: Date.now(),
      };
    } catch (error) {
      console.error('Error processing template:', error);
      return null;
    }
  }

  /**
   * Process a single transaction call with resolved variables
   */
  private static processCall(
    call: TransactionCall,
    resolvedVariables: Record<string, any>
  ): ProcessedCall | null {
    try {
      // Substitute variables in the target address
      const target = this.substituteVariables(call.target, resolvedVariables) as Address;
      
      // Substitute variables in the value
      const value = this.substituteVariables(call.value.toString(), resolvedVariables);
      
      // Substitute variables in the calldata
      const calldata = this.substituteVariables(call.calldata, resolvedVariables) as Hash;

      return {
        target,
        value,
        calldata,
        originalCall: call,
      };
    } catch (error) {
      console.error('Error processing call:', error);
      return null;
    }
  }

  /**
   * Substitute variables in a string using ${variableName} syntax
   */
  private static substituteVariables(
    template: string,
    variables: Record<string, any>
  ): string {
    return template.replace(/\$\{([^}]+)\}/g, (match, variableName) => {
      if (variableName in variables) {
        const value = variables[variableName];
        // Convert BigInt to string for substitution
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return String(value);
      }
      console.warn(`Variable ${variableName} not found in resolved variables`);
      return match; // Keep the placeholder if variable not found
    });
  }

  /**
   * Find missing required variables
   */
  private static findMissingVariables(
    requiredVariables: VariableReference[],
    resolvedVariables: Record<string, any>
  ): string[] {
    const missing: string[] = [];
    
    for (const variable of requiredVariables) {
      if (!(variable.name in resolvedVariables)) {
        missing.push(variable.name);
      }
    }
    
    return missing;
  }

  /**
   * Validate a template before processing
   */
  static validateTemplate(template: TransactionTemplate): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!template.id) {
      errors.push('Template ID is required');
    }

    if (!template.name) {
      errors.push('Template name is required');
    }

    if (!Array.isArray(template.calls) || template.calls.length === 0) {
      errors.push('Template must have at least one call');
    }

    if (!Array.isArray(template.requiredVariables)) {
      errors.push('Required variables must be an array');
    }

    // Validate each call
    for (let i = 0; i < template.calls.length; i++) {
      const call = template.calls[i];
      
      if (!call || !call.target || !call.target.startsWith('0x')) {
        errors.push(`Call ${i}: Invalid target address`);
      }

      if (!call || typeof call.value !== 'bigint' && call.value < 0) {
        errors.push(`Call ${i}: Invalid value`);
      }

      if (!call || !call.calldata || !call.calldata.startsWith('0x')) {
        errors.push(`Call ${i}: Invalid calldata`);
      }

      if (!call || !Array.isArray(call.variables)) {
        errors.push(`Call ${i}: Variables must be an array`);
      }
    }

    // Validate required variables
    for (let i = 0; i < template.requiredVariables.length; i++) {
      const variable = template.requiredVariables[i];
      
      if (!variable || !variable.name) {
        errors.push(`Required variable ${i}: Name is required`);
      }

      if (!variable || !variable.path) {
        errors.push(`Required variable ${i}: Path is required`);
      }

      if (!variable || !['event', 'system', 'user'].includes(variable.type)) {
        errors.push(`Required variable ${i}: Invalid type`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Create a simple ERC20 transfer template
   */
  static createERC20TransferTemplate(
    tokenAddress: Address,
    recipientVariable: string,
    amountVariable: string
  ): TransactionTemplate {
    // ERC20 transfer function signature: transfer(address,uint256)
    const transferSelector = '0xa9059cbb';
    
    return {
      id: `erc20_transfer_${Date.now()}`,
      name: 'ERC20 Transfer',
      description: 'Transfer ERC20 tokens to a recipient',
      calls: [{
        target: tokenAddress,
        value: BigInt(0),
        calldata: `${transferSelector}000000000000000000000000\${${recipientVariable}}0000000000000000000000000000000000000000000000000000000000000000\${${amountVariable}}` as Hash,
        variables: [
          { name: recipientVariable, path: 'args.recipient', type: 'event' },
          { name: amountVariable, path: 'args.amount', type: 'event' },
        ],
      }],
      requiredVariables: [
        { name: recipientVariable, path: 'args.recipient', type: 'event' },
        { name: amountVariable, path: 'args.amount', type: 'event' },
      ],
      estimatedGas: 65000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Create a Uniswap V3 swap template
   */
  static createUniswapV3SwapTemplate(
    routerAddress: Address,
    tokenInVariable: string,
    tokenOutVariable: string,
    amountVariable: string,
    recipientVariable: string
  ): TransactionTemplate {
    // This is a simplified example - real Uniswap V3 calls are more complex
    const swapSelector = '0x414bf389'; // exactInputSingle selector
    
    return {
      id: `uniswap_v3_swap_${Date.now()}`,
      name: 'Uniswap V3 Swap',
      description: 'Swap tokens using Uniswap V3',
      calls: [{
        target: routerAddress,
        value: BigInt(0),
        calldata: `${swapSelector}\${${tokenInVariable}}\${${tokenOutVariable}}\${${amountVariable}}\${${recipientVariable}}` as Hash,
        variables: [
          { name: tokenInVariable, path: 'args.tokenIn', type: 'event' },
          { name: tokenOutVariable, path: 'args.tokenOut', type: 'event' },
          { name: amountVariable, path: 'args.amount', type: 'event' },
          { name: recipientVariable, path: 'user.walletAddress', type: 'system' },
        ],
      }],
      requiredVariables: [
        { name: tokenInVariable, path: 'args.tokenIn', type: 'event' },
        { name: tokenOutVariable, path: 'args.tokenOut', type: 'event' },
        { name: amountVariable, path: 'args.amount', type: 'event' },
        { name: recipientVariable, path: 'user.walletAddress', type: 'system' },
      ],
      estimatedGas: 200000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Estimate gas for a processed multicall
   */
  static estimateGas(processedMulticall: ProcessedMulticall): string {
    // Base gas cost for multicall operation
    let totalGas = 21000;
    
    for (const call of processedMulticall.calls) {
      // Add gas cost per call (simplified estimation)
      if (call.calldata === '0x') {
        totalGas += 21000; // ETH transfer
      } else {
        totalGas += 100000; // Contract interaction base cost
      }
    }
    
    return totalGas.toString();
  }
}