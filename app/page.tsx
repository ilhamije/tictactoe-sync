"use client"

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '@/lib/supabase'
import { RefreshCw, User, Trophy, Share2 } from 'lucide-react'

function TicTacToeContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const roomId = searchParams.get('room')

  const [board, setBoard] = useState<(string | null)[]>(Array(9).fill(null))
  const [mySymbol, setMySymbol] = useState<'X' | 'O' | null>(null)
  const [turn, setTurn] = useState<'X' | 'O'>('X')
  const [winner, setWinner] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const colors = {
    bg: '#E8F5E9',      // Soft Green
    lines: '#9E9E9E',   // Grey
    x: '#2196F3',       // Blue
    o: '#FF9800'        // Orange
  }

  // Check for winner locally
  const checkWinner = (squares: (string | null)[]) => {
    const lines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
      [0, 4, 8], [2, 4, 6]             // diags
    ]
    for (let i = 0; i < lines.length; i++) {
      const [a, b, c] = lines[i]
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return squares[a]
      }
    }
    if (squares.every(s => s !== null)) return 'Draw'
    return null
  }

  const generateRoom = async () => {
    setLoading(true)
    const newRoomId = Math.random().toString(36).substring(2, 9)

    const { error } = await supabase
      .from('games')
      .insert([{ room_id: newRoomId, board: Array(9).fill(null), current_turn: 'X' }])

    if (error) {
      console.error(error)
      setError("Failed to create room. Check your Supabase URL/Key.")
      setLoading(false)
      return
    }

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(`room_${newRoomId}_symbol`, 'X')
    }
    setMySymbol('X')
    router.push(`?room=${newRoomId}`)
    setLoading(false)
  }

  const [players, setPlayers] = useState<{ [key: string]: any }>({})
  const [player2Joined, setPlayer2Joined] = useState(false)

  useEffect(() => {
    // Check for Supabase setup
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setError("Supabase URL or Anon Key is missing in .env.local")
    }
  }, [])

  const fetchGame = useCallback(async (rid: string) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .eq('room_id', rid)
      .maybeSingle()

    if (error) {
      console.error(error)
      setError("Database fetch failed. Check your Supabase setup.")
      setLoading(false)
      return
    }

    if (!data) {
      setError("Room not found. It might have been deleted or the ID is wrong.")
      setLoading(false)
      return
    }

    setBoard(data.board)
    setTurn(data.current_turn as 'X' | 'O')
    setWinner(data.winner)

    const storedSymbol = sessionStorage.getItem(`room_${rid}_symbol`)
    if (storedSymbol === 'X' || storedSymbol === 'O') {
      setMySymbol(storedSymbol)
    } else {
      // If we joined via link and don't have a symbol, we are 'O'
      setMySymbol('O')
      sessionStorage.setItem(`room_${rid}_symbol`, 'O')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (roomId) {
      fetchGame(roomId)

      const channel = supabase.channel(`room:${roomId}`, {
        config: {
          presence: {
            key: mySymbol || 'unknown',
          },
        },
      })

      channel
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `room_id=eq.${roomId}`
        }, (payload) => {
          setBoard(payload.new.board)
          setTurn(payload.new.current_turn)
          setWinner(payload.new.winner)
          setError(null)
        })
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState()
          setPlayers(state)
          // If we see 'O' in the presence state, Player 2 has joined
          setPlayer2Joined(!!state['O'])
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          console.log('join', key, newPresences)
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          console.log('leave', key, leftPresences)
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({ online_at: new Date().toISOString() })
          }
          if (status === 'CHANNEL_ERROR') {
            setError("Real-time sync error. Make sure 'Realtime' is enabled for the 'games' table in Supabase.")
          }
        })

      return () => {
        supabase.removeChannel(channel)
      }
    }
  }, [roomId, fetchGame, mySymbol])

  const handleMove = async (index: number) => {
    if (board[index] || winner || turn !== mySymbol || !roomId) return

    const newBoard = [...board]
    newBoard[index] = mySymbol
    const gameWinner = checkWinner(newBoard)
    const nextTurn = mySymbol === 'X' ? 'O' : 'X'

    const { error } = await supabase
      .from('games')
      .update({
        board: newBoard,
        current_turn: nextTurn,
        winner: gameWinner
      })
      .eq('room_id', roomId)

    if (error) {
      console.error(error)
      setError("Sync failed. Check connection.")
    }
  }

  const resetGame = async () => {
    if (!roomId) return
    const { error } = await supabase
      .from('games')
      .update({
        board: Array(9).fill(null),
        current_turn: 'X',
        winner: null
      })
      .eq('room_id', roomId)

    if (error) {
      console.error(error)
      setError("Reset failed.")
    }
  }

  useEffect(() => {
    if (winner && winner !== 'Draw') {
      setTimeout(() => {
        if (winner === mySymbol) {
          if (confirm("You win, restart game?")) resetGame()
        } else {
          if (confirm("You lose, restart game?")) resetGame()
        }
      }, 100)
    } else if (winner === 'Draw') {
      setTimeout(() => {
        if (confirm("It's a draw, restart game?")) resetGame()
      }, 100)
    }
  }, [winner, mySymbol, roomId])

  const Square = ({ value, index }: { value: string | null, index: number }) => {
    const isClickable = !value && !winner && turn === mySymbol
    return (
      <div
        onClick={() => handleMove(index)}
        className={`w-24 h-24 sm:w-32 sm:h-32 flex items-center justify-center text-6xl font-bold transition-all duration-200 
          ${isClickable ? 'cursor-pointer hover:bg-gray-50 active:scale-95' : 'cursor-default'} 
          bg-white sm:rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]`}
        style={{
          color: value === 'X' ? colors.x : colors.o,
        }}
      >
        {value === 'X' && <span className="animate-in zoom-in duration-300">X</span>}
        {value === 'O' && <span className="animate-in zoom-in duration-300">O</span>}
        {!value && isClickable && (
          <div className="w-4 h-4 rounded-full bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    )
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    alert("Link copied to clipboard!")
  }

  if (!isMounted) return null

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-500" style={{ backgroundColor: colors.bg }}>
      {!roomId ? (
        <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-500">
          <div className="relative">
            <h1 className="text-6xl sm:text-7xl font-black text-gray-800 tracking-tighter flex items-center gap-2">
              TIC <span className="text-[#2196F3]">X</span> TAC <span className="text-[#FF9800]">O</span> E
            </h1>
            <div className="absolute -top-6 -right-6 rotate-12 bg-yellow-400 text-xs font-bold px-2 py-1 rounded shadow-sm">REAL-TIME</div>
          </div>
          <button
            disabled={loading}
            className="group relative px-10 py-5 bg-white text-gray-800 font-black text-xl rounded-2xl shadow-[0_8px_0_0_#9E9E9E] hover:shadow-[0_4px_0_0_#9E9E9E] hover:translate-y-[4px] active:shadow-none active:translate-y-[8px] transition-all flex items-center gap-3 overflow-hidden"
            onClick={generateRoom}
          >
            {loading ? <RefreshCw className="animate-spin" /> : "START MASSIVE BATTLE"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex justify-between w-full items-center bg-white/60 p-4 rounded-2xl backdrop-blur-md border border-white shadow-sm">
            <div className="flex items-center gap-2">
              <div className={`p-2 rounded-lg ${mySymbol === 'X' ? 'bg-blue-100 text-[#2196F3]' : 'bg-orange-100 text-[#FF9800]'}`}>
                <User size={20} />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold text-gray-400">Role</span>
                <span className="font-bold text-gray-800 leading-none">{mySymbol === 'X' ? 'Player 1 (X)' : 'Player 2 (O)'}</span>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase font-bold text-gray-400">Current Turn</span>
              <div className={`px-4 py-1 rounded-full font-bold text-white transition-all transform ${turn === 'X' ? 'bg-[#2196F3]' : 'bg-[#FF9800]'} ${turn === mySymbol ? 'scale-110 shadow-lg' : 'opacity-70'}`}>
                {turn === 'X' ? 'Player 1' : 'Player 2'} {turn === mySymbol ? '(YOU)' : ''}
              </div>
            </div>
          </div>

          {!player2Joined && (
            <div className="p-6 bg-white rounded-[2rem] shadow-xl flex flex-col items-center gap-4 relative group animate-in zoom-in duration-500">
              <div className="relative">
                <QRCodeSVG value={typeof window !== 'undefined' ? window.location.href : ''} size={150} />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 rounded-lg">
                  <button onClick={copyLink} className="bg-gray-800 text-white px-4 py-2 rounded-full flex items-center gap-2 text-xs font-bold">
                    <Share2 size={14} /> Copy Link
                  </button>
                </div>
              </div>
              <div className="text-center">
                <p className="font-bold text-gray-800">Invite Player 2</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold italic">Scan or share the link</p>
              </div>
            </div>
          )}

          <div
            className="grid grid-cols-3 gap-[5px] p-[5px] rounded-2xl shadow-2xl overflow-hidden transform hover:scale-[1.02] transition-transform duration-300"
            style={{ backgroundColor: colors.lines, border: `2px solid ${colors.lines}` }}
          >
            {board.map((val, i) => <Square key={i} index={i} value={val} />)}
          </div>

          <div className="flex flex-col items-center gap-4 w-full">
            <div className="flex items-center gap-2 bg-white/40 px-4 py-2 rounded-full border border-white/60 backdrop-blur-sm">
              <p className="font-mono text-gray-600 text-[10px]">ROOM: <span className="font-bold">{roomId}</span></p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={resetGame}
                className="group flex items-center gap-2 px-6 py-2 bg-gray-800 text-white rounded-full text-xs font-bold shadow-lg hover:bg-gray-700 active:scale-95 transition-all"
              >
                <RefreshCw size={12} className="group-hover:rotate-180 transition-transform duration-500" /> Reset
              </button>
              <button
                onClick={() => router.push('/')}
                className="px-6 py-2 bg-white text-gray-800 rounded-full text-xs font-bold shadow-lg hover:bg-gray-100 active:scale-95 transition-all outline outline-1 outline-gray-200"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-xl shadow-2xl border-2 border-red-600 animate-in fade-in slide-in-from-bottom-4 duration-300 z-50">
          <p className="font-bold flex items-center gap-2">
            ⚠️ {error}
          </p>
        </div>
      )}
    </div>
  )
}

export default function TicTacToe() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#E8F5E9]">
        <RefreshCw className="animate-spin text-gray-400" size={48} />
      </div>
    }>
      <TicTacToeContent />
    </Suspense>
  )
}
