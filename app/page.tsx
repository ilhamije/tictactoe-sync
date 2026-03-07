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
  const [scores, setScores] = useState({ p1: 0, p2: 0 })
  const [p1Symbol, setP1Symbol] = useState<'X' | 'O'>('X')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [selectedStartSymbol, setSelectedStartSymbol] = useState<'X' | 'O'>('X')

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const colors = {
    bg: '#E8F5E9',      // Soft Green
    lines: '#bcbabaff',   // Grey
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
      .insert([{
        room_id: newRoomId,
        board: Array(9).fill(null),
        current_turn: 'X',
        p1_symbol: selectedStartSymbol,
        p1_score: 0,
        p2_score: 0
      }])

    if (error) {
      console.error(error)
      setError("Failed to create room. Make sure your 'games' table has p1_symbol (text), p1_score (int), and p2_score (int) columns.")
      setLoading(false)
      return
    }

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(`room_${newRoomId}_role`, 'p1')
    }
    setMySymbol(selectedStartSymbol)
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
    setScores({ p1: data.p1_score || 0, p2: data.p2_score || 0 })
    const currentP1Symbol = (data.p1_symbol as 'X' | 'O') || 'X'
    setP1Symbol(currentP1Symbol)

    const role = sessionStorage.getItem(`room_${rid}_role`)
    if (role === 'p1') {
      setMySymbol(currentP1Symbol)
    } else if (role === 'p2') {
      setMySymbol(currentP1Symbol === 'X' ? 'O' : 'X')
    } else {
      // Joining for the first time
      sessionStorage.setItem(`room_${rid}_role`, 'p2')
      setMySymbol(currentP1Symbol === 'X' ? 'O' : 'X')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (roomId) {
      // We don't call fetchGame here anymore because we'll trigger it with a dependency
      // Or just keep it but ensure the channel logic handles the role update.
      fetchGame(roomId)
    }
  }, [roomId, fetchGame])

  useEffect(() => {
    // Only subscribe once we have a roomId
    if (!roomId) return

    const currentRole = sessionStorage.getItem(`room_${roomId}_role`)

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        presence: {
          key: currentRole || 'unknown',
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
        setScores({ p1: payload.new.p1_score || 0, p2: payload.new.p2_score || 0 })
        const currentP1Symbol = payload.new.p1_symbol
        setP1Symbol(currentP1Symbol)

        const role = sessionStorage.getItem(`room_${roomId}_role`)
        if (role === 'p1') {
          setMySymbol(currentP1Symbol)
        } else if (role === 'p2') {
          setMySymbol(currentP1Symbol === 'X' ? 'O' : 'X')
        }
        setError(null)
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        setPlayers(state)
        // Check if both p1 and p2 are present in the room
        setPlayer2Joined(!!state['p2'])
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // If we were 'unknown' initially, we might need to re-track once fetchGame completes
          // But a better way is to wait for the role to be set before subscribing or re-tracking.
          await channel.track({ online_at: new Date().toISOString() })
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [roomId, mySymbol]) // Re-run if mySymbol changes (which happens when fetchGame sets role)

  const handleMove = async (index: number) => {
    if (board[index] || winner || turn !== mySymbol || !roomId) return

    const newBoard = [...board]
    newBoard[index] = mySymbol
    const gameWinner = checkWinner(newBoard)
    const nextTurn = mySymbol === 'X' ? 'O' : 'X'

    let newP1Score = scores.p1
    let newP2Score = scores.p2

    if (gameWinner && gameWinner !== 'Draw') {
      // Determine if p1 or p2 won based on their symbol
      const p1IsWinner = gameWinner === p1Symbol
      if (p1IsWinner) newP1Score++
      else newP2Score++
    }

    const { error } = await supabase
      .from('games')
      .update({
        board: newBoard,
        current_turn: nextTurn,
        winner: gameWinner,
        p1_score: newP1Score,
        p2_score: newP2Score
      })
      .eq('room_id', roomId)

    if (error) {
      console.error(error)
      setError("Sync failed.")
    }
  }

  const resetGame = async () => {
    if (!roomId) return

    // Auto switch side: toggle Player 1's symbol
    const nextP1Symbol = p1Symbol === 'X' ? 'O' : 'X'

    const { error } = await supabase
      .from('games')
      .update({
        board: Array(9).fill(null),
        current_turn: 'X', // Standard: X always starts
        winner: null,
        p1_symbol: nextP1Symbol
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
          <div className="flex flex-col items-center gap-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Choose Your Weapon</p>
            <div className="flex gap-4">
              <button
                onClick={() => setSelectedStartSymbol('X')}
                className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black transition-all ${selectedStartSymbol === 'X' ? 'bg-[#2196F3] text-white scale-110 shadow-lg' : 'bg-white text-[#2196F3] border-2 border-[#2196F3]/20 hover:scale-105'}`}
              >
                X
              </button>
              <button
                onClick={() => setSelectedStartSymbol('O')}
                className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-black transition-all ${selectedStartSymbol === 'O' ? 'bg-[#FF9800] text-white scale-110 shadow-lg' : 'bg-white text-[#FF9800] border-2 border-[#FF9800]/20 hover:scale-105'}`}
              >
                O
              </button>
            </div>
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
          <div className="flex flex-col gap-4 w-full">
            <div className="flex justify-between w-full items-center bg-white/60 p-4 rounded-2xl backdrop-blur-md border border-white shadow-sm relative overflow-hidden">
              {/* Progress bar for scores? Or just numbers */}
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${sessionStorage.getItem(`room_${roomId}_role`) === 'p1' ? 'bg-blue-100 text-[#2196F3]' : 'bg-orange-100 text-[#FF9800]'}`}>
                  <User size={20} />
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-gray-400">You ({sessionStorage.getItem(`room_${roomId}_role`) === 'p1' ? 'P1' : 'P2'})</span>
                  <span className="font-bold text-gray-800 leading-none text-lg">{mySymbol}</span>
                </div>
              </div>

              <div className="flex flex-col items-center">
                <span className="text-[10px] uppercase font-bold text-gray-400 mb-1">Turn</span>
                <div className={`px-4 py-1 rounded-full font-bold text-white transition-all transform ${turn === 'X' ? 'bg-[#2196F3]' : 'bg-[#FF9800]'} ${turn === mySymbol ? 'scale-110 shadow-lg' : 'opacity-70'}`}>
                  {turn === 'X' ? (p1Symbol === 'X' ? 'P1' : 'P2') : (p1Symbol === 'O' ? 'P1' : 'P2')} {turn === mySymbol ? '(YOU)' : ''}
                </div>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-gray-400">Rival</span>
                  <span className="font-bold text-gray-800 leading-none text-lg">{mySymbol === 'X' ? 'O' : 'X'}</span>
                </div>
                <div className={`p-2 rounded-lg ${sessionStorage.getItem(`room_${roomId}_role`) === 'p1' ? 'bg-orange-100 text-[#FF9800]' : 'bg-blue-100 text-[#2196F3]'}`}>
                  <User size={20} />
                </div>
              </div>
            </div>

            {/* Scoreboard Section */}
            <div className="grid grid-cols-2 gap-4 w-full">
              <div className="bg-white/40 p-3 rounded-xl border border-white/60 flex flex-col items-center">
                <span className="text-[9px] uppercase font-black text-gray-400">Player 1</span>
                <span className="text-2xl font-black text-gray-800 tracking-tighter">{scores.p1}</span>
                <div className={`w-full h-1 mt-2 rounded-full bg-gray-200 overflow-hidden`}>
                  <div className="h-full bg-[#2196F3] transition-all duration-500" style={{ width: `${(scores.p1 / (scores.p1 + scores.p2 || 1)) * 100}%` }} />
                </div>
              </div>
              <div className="bg-white/40 p-3 rounded-xl border border-white/60 flex flex-col items-center">
                <span className="text-[9px] uppercase font-black text-gray-400">Player 2</span>
                <span className="text-2xl font-black text-gray-800 tracking-tighter">{scores.p2}</span>
                <div className={`w-full h-1 mt-2 rounded-full bg-gray-200 overflow-hidden`}>
                  <div className="h-full bg-[#FF9800] transition-all duration-500" style={{ width: `${(scores.p2 / (scores.p1 + scores.p2 || 1)) * 100}%` }} />
                </div>
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
