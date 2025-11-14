import React, { useState } from 'react';

function App() {
  const [containerId, setContainerId] = useState('1');
  const [pillConfig, setPillConfig] = useState('PillA,PillB');
  const [times, setTimes] = useState('08:00,20:00');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('http://localhost:3000/set-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          container_id: containerId,
          pill_config: pillConfig.split(',').map(x => x.trim()),
          times: times.split(',').map(x => x.trim())
        }),
      });
      const data = await response.json();
      setResult(data.message || JSON.stringify(data));
    } catch (e) {
      setResult('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '50px auto', fontFamily: 'Arial' }}>
      <h2>Pill Container Schedule</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Container ID: </label>
          <input value={containerId} onChange={e => setContainerId(e.target.value)} type="number" min="1" required />
        </div>
        <div>
          <label>Pill Config (comma-separated): </label>
          <input value={pillConfig} onChange={e => setPillConfig(e.target.value)} required />
        </div>
        <div>
          <label>Times (24h, comma-separated): </label>
          <input value={times} onChange={e => setTimes(e.target.value)} required />
        </div>
        <button type="submit" disabled={loading}>{loading ? 'Setting...' : 'Set Schedule & Confirm'}</button>
      </form>
      {result && (
        <div style={{ marginTop: 20, padding: 10, background: '#eef', borderRadius: 4 }}>
          <b>Result:</b> {result}
        </div>
      )}
    </div>
  );
}

export default App;
