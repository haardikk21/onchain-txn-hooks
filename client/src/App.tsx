import { AuthButton } from './components/AuthButton'

function App() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Onchain Transaction Hooks</h1>
        <AuthButton />
      </header>
      
      <main className="flex flex-col gap-6">
        <div className="text-center py-12">
          <h2 className="text-5xl font-black mb-4">🪝</h2>
          <h2 className="text-2xl font-bold mb-2">Automated On-Chain Transactions</h2>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Bid in perpetual auctions for the right to auto-trigger transactions 
            in response to specific blockchain events. Connect your wallet to get started.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="border rounded-lg p-6">
            <h3 className="font-semibold mb-2">🏆 Auction System</h3>
            <p className="text-sm text-gray-600">
              Bid on event signatures to win automation rights. Highest bidder gets to trigger transactions.
            </p>
          </div>
          
          <div className="border rounded-lg p-6">
            <h3 className="font-semibold mb-2">⚡ Ultra-Fast Execution</h3>
            <p className="text-sm text-gray-600">
              Using Flashblocks WebSocket + sendRawTransactionSync for ~200ms execution times.
            </p>
          </div>
          
          <div className="border rounded-lg p-6">
            <h3 className="font-semibold mb-2">🔧 Custom Templates</h3>
            <p className="text-sm text-gray-600">
              Build complex transaction workflows with variable injection from event data.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App