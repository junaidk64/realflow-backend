export declare module IGeocode {
	interface AddressComponent {
		long_name: string
		short_name: string
		types: string[]
	}

	interface AddressPrediction {
		description: string
		place_id: string
		types: string[]
		structured_formatting: {
			main_text: string
			secondary_text: string
		}
	}

	interface Direction {
		routes: [
			{
				bounds: {
					northeast: IGeocodeLatLng
					southwest: IGeocodeLatLng
				}
				copyrights: string
				legs: [
					{
						distance: {
							text: string
							value: number
						}
						duration: {
							text: string
							value: number
						}
						end_address: string
						end_location: IGeocodeLatLng
						start_address: string
						start_location: IGeocodeLatLng
						traffic_speed_entry: []
						via_waypoint: []
					},
				]
				overview_polyline: { points: string }
				summary: string
				warnings: []
				waypoint_order: []
			},
		]
		status: 'OK'
	}

	interface IGeocodeLatLng {
		lat: number
		lng: number
	}
}
export declare namespace IRadarAddressFromCoordsResponse {
	interface Meta {
		code: number
	}

	interface Geometry {
		type: string
		coordinates: number[]
	}

	interface Address {
		latitude: number
		longitude: number
		geometry: Geometry
		country: string
		countryCode: string
		countryFlag: string
		distance: number
		county?: string
		city?: string
		stateCode: string
		state: string
		layer: string
		formattedAddress: string
		placeLabel?: string
		addressLabel?: string
	}

	interface RadarGeocodeResponse {
		meta: Meta
		addresses: Address[]
	}
}
