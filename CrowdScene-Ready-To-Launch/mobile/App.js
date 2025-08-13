import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Button, FlatList, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';

const API_URL = "http://localhost:4000"; // set to your Render URL when deployed

const API = async (path, opts={}) => {
  const r = await fetch(`${API_URL}${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return r.json();
};

export default function App() {
  const [items, setItems] = useState([]);
  const [coords, setCoords] = useState(null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { alert('Permission to access location was denied'); return; }
      let location = await Location.getCurrentPositionAsync({});
      setCoords({ lat: location.coords.latitude, lng: location.coords.longitude });
      const u = await API('/api/users/anon', { method:'POST', body: JSON.stringify({}) });
      setUserId(u.id);
    })();
  }, []);

  const search = async () => {
    if(!coords) return;
    const data = await API(`/api/places/nearby?lat=${coords.lat}&lng=${coords.lng}&radius=5`);
    setItems(data);
  };
  const checkin = async (venueId) => {
    if(!userId) return;
    const r = await API('/api/checkins', { method:'POST', body: JSON.stringify({ userId, venueId })});
    if(r.error){ alert(r.error); return; }
    search();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>CrowdScene Mobile</Text>
      <Button title="Search Nearby" onPress={search} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => checkin(item.id)}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.text}>{item.type} • ${item.cover || 0} cover</Text>
            <Text style={styles.text}>Crowd: {item.crowd.toFixed(2)} • {item.distance?.toFixed(2)} mi</Text>
          </TouchableOpacity>
        )}
      />
      <Text style={styles.note}>Set API_URL to your Render URL for iPhone testing.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', paddingTop: 60, paddingHorizontal: 14 },
  title: { color:'#e9f1f7', fontSize: 20, marginBottom: 10 },
  card: { backgroundColor:'#0f141b', padding:12, borderRadius:10, marginVertical:6 },
  name: { color:'#e9f1f7', fontWeight:'700' },
  text: { color:'#cbd5e1' },
  note: { color:'#94a3b8', marginTop: 8, fontSize: 12 }
});
